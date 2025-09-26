import { Request, Response, NextFunction } from 'express';

export interface TenantRequest extends Request {
  tenantId?: string;
}

export const tenantMiddleware = (req: TenantRequest, res: Response, next: NextFunction) => {
  const host = req.headers.host; // ex: cliente1.meusite.com
  if (!host) return res.status(400).send('Host header missing');

  const subdomain = host.split('.')[0];
  req.tenantId = subdomain; //cliente1

  next();
};
