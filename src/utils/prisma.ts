import { PrismaClient, Prisma as PrismaNamespace } from '@prisma/client';
import { Logger } from '../utils/logger';
import { DatabaseError } from '../utils/errors';

// 🔹 Prisma default (opcional)
export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
  ],
});

const dbLogger = new Logger({ service: 'database' });
export { PrismaNamespace as Prisma };

// --- Logging global
prisma.$on('error', (e: any) => dbLogger.error('Database error occurred', e));
prisma.$on('info', (e: any) => dbLogger.info('Database info', { message: e.message }));
prisma.$on('warn', (e: any) => dbLogger.warn('Database warning', { message: e.message }));

// ============================================================
// 🔹 MULTI-TENANT SUPPORT
// ============================================================

const prismaInstances: Record<string, PrismaClient> = {};

/**
 * Retorna a instância do Prisma para um tenant.
 * Se não existir, cria uma nova instância (lazy).
 */
export function getPrismaForTenant(tenantId: string): PrismaClient {
  if (!tenantId) throw new Error('Tenant ID must be provided');

  tenantId = tenantId.trim().toUpperCase(); // normaliza

  if (prismaInstances[tenantId]) return prismaInstances[tenantId];

  const envVarName = `DATABASE_URL_${tenantId}`;
  const databaseUrl = process.env[envVarName];

  dbLogger.info(`[TENANT-LOADER] tenantId=${tenantId} | env=${envVarName} | url=${process.env[envVarName]}`);

  if (!databaseUrl) {
    throw new Error(
      `No database URL found for tenant: ${tenantId} (missing ${envVarName} in .env)`,
    );
  }

  dbLogger.info(`Initializing Prisma client for tenant: ${tenantId}`);

  const tenantPrisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'info' },
    ],
    datasources: { db: { url: databaseUrl } },
  });

  tenantPrisma.$on('error', (e: any) => dbLogger.error(`[Tenant ${tenantId}] Database error`, e));
  tenantPrisma.$on('warn', (e: any) => dbLogger.warn(`[Tenant ${tenantId}] Database warning`, e));

  prismaInstances[tenantId] = tenantPrisma;
  return tenantPrisma;
}

// ============================================================
// 🔹 Database Manager (multi-tenant)
// ============================================================

export class DatabaseManager {
  private static instance: DatabaseManager;
  private isConnected: Record<string, boolean> = {};

  private constructor() {}

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) DatabaseManager.instance = new DatabaseManager();
    return DatabaseManager.instance;
  }

  public async connect(tenantId?: string): Promise<void> {
    try {
      const client = tenantId ? getPrismaForTenant(tenantId) : prisma;
      if (!this.isConnected[tenantId ?? 'default']) {
        await client.$connect();
        this.isConnected[tenantId ?? 'default'] = true;
        dbLogger.info(`Database connected for tenant: ${tenantId ?? 'default'}`);
      }
    } catch (error) {
      dbLogger.error('Failed to connect to database', error);
      throw new DatabaseError('Failed to connect to database', error);
    }
  }

  public async disconnect(tenantId?: string): Promise<void> {
    try {
      if (tenantId && prismaInstances[tenantId]) {
        await prismaInstances[tenantId].$disconnect();
        delete prismaInstances[tenantId];
        this.isConnected[tenantId] = false;
        dbLogger.info(`Tenant ${tenantId} disconnected successfully`);
      } else {
        await prisma.$disconnect();
        this.isConnected['default'] = false;
        dbLogger.info('Default database disconnected successfully');
      }
    } catch (error) {
      dbLogger.error('Failed to disconnect from database', error);
      throw new DatabaseError('Failed to disconnect from database', error);
    }
  }

  public isHealthy(tenantId?: string): boolean {
    return !!this.isConnected[tenantId ?? 'default'];
  }

  public async healthCheck(tenantId?: string): Promise<boolean> {
    try {
      const client = tenantId ? getPrismaForTenant(tenantId) : prisma;
      await client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      dbLogger.error(`Database health check failed for tenant ${tenantId ?? 'default'}`, error);
      return false;
    }
  }
}

// ============================================================
// 🔹 Helpers
// ============================================================

export async function withTransaction<T>(
  callback: (
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$transaction' | '$on' | '$extends'>,
  ) => Promise<T>,
  tenantId?: string,
): Promise<T> {
  const client = tenantId ? getPrismaForTenant(tenantId) : prisma;
  return client.$transaction(async (tx) => {
    return await callback(tx as any);
  });
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxRetries) throw lastError;
      dbLogger.warn(`Retrying DB operation (attempt ${attempt}/${maxRetries})`, {
        error: lastError.message,
      });
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
  throw lastError!;
}

// ============================================================
// 🔹 Exports
// ============================================================

export const databaseManager = DatabaseManager.getInstance();
export default prisma;
