import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
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
    let tenant = (req.headers['x-tenant'] as string | undefined)?.toLowerCase();

    if (!tenant) {
      const tenantQuery = (req.query?.tenant as string | undefined)?.toLowerCase();
      if (tenantQuery) tenant = tenantQuery;
    }

    if (!tenant) {
      const host = req.headers.host;
      if (!host) return res.status(400).send('Host header missing');

      const hostname = host.split(':')[0].toLowerCase();
      const parts = hostname.split('.');
      const forbidden = ['www', 'api', 'app'];
      const candidate = parts.find((part) => part && !forbidden.includes(part));

      tenant = candidate;
    }

    if (!tenant || !/^[a-z0-9-]+$/.test(tenant)) {
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
