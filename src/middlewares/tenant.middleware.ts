import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '../../generated/prisma/client';
import { getPrismaForTenant } from '../utils/prisma';
import Logger from '../utils/logger';

export interface TenantRequest extends Request {
  tenantId?: string;
}

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

const logger = new Logger({ service: 'tenant-middleware' });

export const tenantMiddleware = async (req: TenantRequest, res: Response, next: NextFunction) => {
  try {
    let tenant = (req.headers['x-tenant'] as string)?.toLowerCase();

    if (!tenant) {
      const tenantQuery = (req.query?.tenant as string | undefined)?.toLowerCase();
      if (tenantQuery) tenant = tenantQuery;
    }

    if (!tenant) {
      const host = req.headers.host;
      if (!host) return res.status(400).send('Host header missing');

      const hostname = host.split(':')[0].toLowerCase();
      const parts = hostname.split('.');

      if (parts.length >= 3 && (parts[0] === 'www' || parts[0] === 'app')) {
        tenant = parts[1];
      } else {
        tenant = parts[0];
      }
    }

    if (!tenant || !/^[a-z0-9-]+$/.test(tenant) || ['www', 'api', 'app'].includes(tenant)) {
      return res.status(400).send('Invalid tenant');
    }

    req.tenantId = tenant;
    req.prisma = getPrismaForTenant(tenant);

    logger.info(`Request routed to tenant: ${tenant}`);

    next();
  } catch (error) {
    logger.error('Tenant middleware error', error);
    res.status(500).send('Tenant resolution failed');
  }
};
