"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantMiddleware = void 0;
const prisma_1 = require("../utils/prisma");
const logger_1 = __importDefault(require("../utils/logger"));
const logger = new logger_1.default({ service: 'tenant-middleware' });
const tenantMiddleware = async (req, res, next) => {
    try {
        let tenant = req.headers['x-tenant']?.toLowerCase();
        if (!tenant) {
            const host = req.headers.host;
            if (!host)
                return res.status(400).send('Host header missing');
            const hostname = host.split(':')[0].toLowerCase();
            tenant = hostname.split('.')[0];
        }
        if (!tenant || !/^[a-z0-9-]+$/.test(tenant) || ['www', 'api'].includes(tenant)) {
            return res.status(400).send('Invalid tenant');
        }
        req.tenantId = tenant;
        req.prisma = (0, prisma_1.getPrismaForTenant)(tenant);
        logger.info(`Request routed to tenant: ${tenant}`);
        next();
    }
    catch (error) {
        logger.error('Tenant middleware error', error);
        res.status(500).send('Tenant resolution failed');
    }
};
exports.tenantMiddleware = tenantMiddleware;
