import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import Logger from '../utils/logger';
import { PrismaClient } from '../../generated/prisma/client';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class AuthController {
  private service = new AuthService();
  private logger = new Logger({ service: 'AuthController' });

  async login(req: TenantRequest, res: Response) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ message: 'Email e senha são obrigatórios' });
        return;
      }

      if (!req.tenantId) {
        res.status(400).json({ message: 'Tenant unknown' });
        return;
      }

      const user = await this.service.validateUser(email, password, req.tenantId);

      if (!user) return res.status(401).json({ message: 'Credenciais inválidas' });

      const token = this.service.generateToken(user);

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        domain: process.env.APP_MODE === 'PROD' ? '.planvita.com.br' : undefined,
        maxAge: 1000 * 60 * 60 * 24, // 1 dia
      });

      res.json(user);
    } catch (error) {
      this.logger.error('Erro ao realizar login', error);
      res.status(500).json({ message: 'Erro interno no servidor' });
    }
  }

  async logout(req: Request, res: Response) {
    res.cookie('auth_token', '', { maxAge: -1 });
    res.json({ message: 'Logout realizado com sucesso' });
  }
}
