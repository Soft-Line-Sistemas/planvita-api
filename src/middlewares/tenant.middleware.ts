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
      
      // Se for um domínio da Vercel ou o domínio principal, não tentamos extrair o tenant do hostname
      // a menos que haja um subdomínio explícito antes do nome do projeto.
      const isVercel = hostname.includes('vercel.app');
      const isMainDomain = hostname === 'planvita.com.br' || hostname === 'localhost';

      if (!isVercel && !isMainDomain) {
        const parts = hostname.split('.');
        const forbidden = ['www', 'api', 'app'];
        const candidate = parts.find((part) => part && !forbidden.includes(part));
        tenant = candidate;
      }
    }

    // Fallback para um tenant padrão se estiver em desenvolvimento ou se for uma rota de health
    if (!tenant && (process.env.NODE_ENV === 'development' || req.path.includes('health'))) {
      tenant = 'lider'; // Ou qualquer outro tenant padrão
    }

    if (!tenant) {
      return res.status(400).send('Tenant not identified. Please provide X-Tenant header or tenant query param.');
    }

    if (!/^[a-z0-9-]+$/.test(tenant)) {
      return res.status(400).send('Invalid tenant format');
    }

    req.tenantId = tenant;
    try {
      req.prisma = getPrismaForTenant(tenant);
    } catch (e: any) {
      logger.error(`Failed to get Prisma for tenant ${tenant}`, e);
      return res.status(404).send(`Tenant database not configured: ${tenant}`);
    }

    logger.info(`Request routed to tenant: ${tenant}`);

    next();
  } catch (error) {
    logger.error('Tenant middleware error', error);
    res.status(500).send('Tenant resolution failed');
  }
};
