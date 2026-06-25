import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaForTenant } from '../utils/prisma';
import Logger from '../utils/logger';
import jwt from 'jsonwebtoken';
import config from '../config';
import type { ClienteJwtPayload } from '../services/cliente-auth.service';

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
    const isClienteLoginRoute = req.path.includes('/auth/login');
    let tenant = (req.headers['x-tenant'] as string | undefined)?.toLowerCase();

    if (!tenant) {
      const tenantQuery = (req.query?.tenant as string | undefined)?.toLowerCase();
      if (tenantQuery) tenant = tenantQuery;
    }

    // Fallback para rotas do cliente autenticado: usa tenant dentro do cliente_token.
    // Isso mantém sessão no refresh mesmo sem query/header/cookie "tenant" no frontend.
    if (!tenant) {
      const clienteToken = (req as any).cookies?.cliente_token as string | undefined;
      if (clienteToken) {
        try {
          const decoded = jwt.verify(clienteToken, config.jwt.secret) as ClienteJwtPayload;
          const tenantFromToken = String(decoded?.tenant ?? '').trim().toLowerCase();
          if (tenantFromToken) tenant = tenantFromToken;
        } catch {
          // Token inválido/expirado: segue fluxo normal de resolução de tenant.
        }
      }
    }

    if (!tenant) {
      const host = req.headers.host;
      if (!host) return res.status(400).send('Host header missing');

      const hostname = host.split(':')[0].toLowerCase();
      
      // Se for um domínio da Vercel ou o domínio principal, não tentamos extrair o tenant do hostname
      // a menos que haja um subdomínio explícito antes do nome do projeto.
      const isVercel = hostname.includes('vercel.app');
      const isMainDomain = hostname === 'planvita.com.br' || hostname === 'localhost';
      const isGenericSubdomain = hostname === 'app.planvita.com.br' || hostname === 'api.planvita.com.br';

      if (!isVercel && !isMainDomain && !isGenericSubdomain) {
        const parts = hostname.split('.');
        const forbidden = ['www', 'api', 'app'];
        const candidate = parts.find((part) => part && !forbidden.includes(part));
        tenant = candidate;
      }
    }

    // Health pode responder mesmo sem tenant explícito.
    if (!tenant && req.path.includes('health')) {
      tenant = 'lider';
    }

    if (!tenant) {
      if (isClienteLoginRoute) {
        return next();
      }
      return res.status(400).send('Tenant not identified. Please provide X-Tenant header or tenant query param.');
    }

    if (!/^[a-z0-9-]+$/.test(tenant)) {
      if (isClienteLoginRoute) {
        return res.status(404).send('Tenant database not configured');
      }
      return res.status(400).send('Invalid tenant format');
    }

    req.tenantId = tenant;
    try {
      req.prisma = getPrismaForTenant(tenant);
    } catch (e: any) {
      if (isClienteLoginRoute) {
        logger.warn(`Skipping tenant db binding on login route for tenant ${tenant}`, {
          reason: e?.message,
        });
        return next();
      }
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
