"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseManager = exports.DatabaseManager = exports.Prisma = exports.prisma = void 0;
exports.getPrismaForTenant = getPrismaForTenant;
exports.withTransaction = withTransaction;
exports.withRetry = withRetry;
const client_1 = require("../../generated/prisma/client");
Object.defineProperty(exports, "Prisma", { enumerable: true, get: function () { return client_1.Prisma; } });
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
// 🔹 Prisma default (opcional)
exports.prisma = new client_1.PrismaClient({
    log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
    ],
});
const dbLogger = new logger_1.Logger({ service: 'database' });
// --- Logging global
exports.prisma.$on('error', (e) => dbLogger.error('Database error occurred', e));
exports.prisma.$on('info', (e) => dbLogger.info('Database info', { message: e.message }));
exports.prisma.$on('warn', (e) => dbLogger.warn('Database warning', { message: e.message }));
// ============================================================
// 🔹 MULTI-TENANT SUPPORT
// ============================================================
const prismaInstances = {};
/**
 * Retorna a instância do Prisma para um tenant.
 * Se não existir, cria uma nova instância (lazy).
 */
function getPrismaForTenant(tenantId) {
    if (!tenantId)
        throw new Error('Tenant ID must be provided');
    tenantId = tenantId.trim().toUpperCase(); // normaliza
    if (prismaInstances[tenantId])
        return prismaInstances[tenantId];
    const envVarName = `DATABASE_URL_${tenantId}`;
    const databaseUrl = process.env[envVarName];
    console.log(`[TENANT-LOADER] tenantId=${tenantId} | env=${envVarName} | url=${process.env[envVarName]}`);
    if (!databaseUrl) {
        throw new Error(`No database URL found for tenant: ${tenantId} (missing ${envVarName} in .env)`);
    }
    dbLogger.info(`Initializing Prisma client for tenant: ${tenantId}`);
    console.log(databaseUrl);
    const tenantPrisma = new client_1.PrismaClient({
        log: [
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'info' },
        ],
        datasources: { db: { url: databaseUrl } },
    });
    tenantPrisma.$on('error', (e) => dbLogger.error(`[Tenant ${tenantId}] Database error`, e));
    tenantPrisma.$on('warn', (e) => dbLogger.warn(`[Tenant ${tenantId}] Database warning`, e));
    prismaInstances[tenantId] = tenantPrisma;
    return tenantPrisma;
}
// ============================================================
// 🔹 Database Manager (multi-tenant)
// ============================================================
class DatabaseManager {
    constructor() {
        this.isConnected = {};
    }
    static getInstance() {
        if (!DatabaseManager.instance)
            DatabaseManager.instance = new DatabaseManager();
        return DatabaseManager.instance;
    }
    async connect(tenantId) {
        try {
            const client = tenantId ? getPrismaForTenant(tenantId) : exports.prisma;
            if (!this.isConnected[tenantId ?? 'default']) {
                await client.$connect();
                this.isConnected[tenantId ?? 'default'] = true;
                dbLogger.info(`Database connected for tenant: ${tenantId ?? 'default'}`);
            }
        }
        catch (error) {
            dbLogger.error('Failed to connect to database', error);
            throw new errors_1.DatabaseError('Failed to connect to database', error);
        }
    }
    async disconnect(tenantId) {
        try {
            if (tenantId && prismaInstances[tenantId]) {
                await prismaInstances[tenantId].$disconnect();
                delete prismaInstances[tenantId];
                this.isConnected[tenantId] = false;
                dbLogger.info(`Tenant ${tenantId} disconnected successfully`);
            }
            else {
                await exports.prisma.$disconnect();
                this.isConnected['default'] = false;
                dbLogger.info('Default database disconnected successfully');
            }
        }
        catch (error) {
            dbLogger.error('Failed to disconnect from database', error);
            throw new errors_1.DatabaseError('Failed to disconnect from database', error);
        }
    }
    isHealthy(tenantId) {
        return !!this.isConnected[tenantId ?? 'default'];
    }
    async healthCheck(tenantId) {
        try {
            const client = tenantId ? getPrismaForTenant(tenantId) : exports.prisma;
            await client.$queryRaw `SELECT 1`;
            return true;
        }
        catch (error) {
            dbLogger.error(`Database health check failed for tenant ${tenantId ?? 'default'}`, error);
            return false;
        }
    }
}
exports.DatabaseManager = DatabaseManager;
// ============================================================
// 🔹 Helpers
// ============================================================
async function withTransaction(callback, tenantId) {
    const client = tenantId ? getPrismaForTenant(tenantId) : exports.prisma;
    return client.$transaction(async (tx) => {
        return await callback(tx);
    });
}
async function withRetry(operation, maxRetries = 3, delay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
            lastError = error;
            if (attempt === maxRetries)
                throw lastError;
            dbLogger.warn(`Retrying DB operation (attempt ${attempt}/${maxRetries})`, {
                error: lastError.message,
            });
            await new Promise((r) => setTimeout(r, delay));
            delay *= 2;
        }
    }
    throw lastError;
}
// ============================================================
// 🔹 Exports
// ============================================================
exports.databaseManager = DatabaseManager.getInstance();
exports.default = exports.prisma;
