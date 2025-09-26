import { PrismaClient } from '../../generated/prisma/client';

const prismaInstances: Record<string, PrismaClient> = {};

export function getPrismaForTenant(tenantId: string): PrismaClient {
  if (!prismaInstances[tenantId]) {
    prismaInstances[tenantId] = new PrismaClient({
      log: ['query', 'error', 'info'],
      datasources: {
        db: {
          url: `sqlserver://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT};database=${tenantId};encrypt=true`,
        },
      },
    });
  }
  return prismaInstances[tenantId];
}
