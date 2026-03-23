import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import type { ClienteJwtPayload } from '../services/cliente-auth.service';
import type { AuthRequest } from '../types/auth';

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

