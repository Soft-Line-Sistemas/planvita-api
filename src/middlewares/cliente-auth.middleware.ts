import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import type { ClienteJwtPayload } from '../services/cliente-auth.service';
import type { AuthRequest, UserPayload } from '../types/auth';

export type ClienteAuthRequest = AuthRequest & {
  cliente?: ClienteJwtPayload;
};

export function authenticateCliente(req: ClienteAuthRequest, res: Response, next: NextFunction) {
  const token = (req as any).cookies?.cliente_token;
  if (!token) return res.status(401).json({ message: 'Não autenticado' });

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as ClienteJwtPayload;
    req.cliente = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido' });
  }
}

export function authenticateAdminOrCliente(
  req: ClienteAuthRequest,
  res: Response,
  next: NextFunction,
) {
  const clienteToken = (req as any).cookies?.cliente_token;
  if (clienteToken) {
    try {
      const decoded = jwt.verify(clienteToken, config.jwt.secret) as ClienteJwtPayload;
      req.cliente = decoded;
      return next();
    } catch {
      // Continua para tentar autenticação administrativa.
    }
  }

  const adminToken = (req as any).cookies?.auth_token;
  if (adminToken) {
    try {
      const decoded = jwt.verify(adminToken, config.jwt.secret) as UserPayload;
      req.user = decoded;
      return next();
    } catch {
      return res.status(401).json({ message: 'Token inválido' });
    }
  }

  return res.status(401).json({ message: 'Não autenticado' });
}
