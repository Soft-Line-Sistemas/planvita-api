import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { getPrismaForTenant } from '../utils/prisma';
import { AuthRequest } from '../types/auth';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class AuthController {
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
      const service = new AuthService(req.tenantId);

      const user = await service.validateUser(email, password);

      if (!user) return res.status(401).json({ message: 'Credenciais inválidas' });

      const token = service.generateToken(user);

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: process.env.NODE_ENV === 'production' ? '.planvita.com.br' : undefined,
        maxAge: 1000 * 60 * 60 * 24, // 1 dia
      });

      res.json(user);
    } catch (error) {
      this.logger.error('Erro ao realizar login', error);
      res.status(500).json({ message: 'Erro interno no servidor' });
    }
  }

  async check(req: AuthRequest, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Não autenticado' });
      }
      const prisma = getPrismaForTenant(req.user.tenant);

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          roles: {
            include: {
              role: {
                include: {
                  RolePermission: {
                    include: { permission: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });

      const role = user.roles[0]?.role || null;
      const permissions = user.roles.flatMap((r) =>
        r.role.RolePermission.map((rp) => rp.permission.name),
      );
      const consultor = await prisma.consultor.findUnique({
        where: { userId: user.id },
        select: {
          id: true,
          nome: true,
          valorComissaoIndicacao: true,
        },
      });

      let consultorResumo: {
        id: number;
        nome: string;
        valorComissaoIndicacao: number;
        comissaoPendente: number;
        comissaoPaga: number;
      } | null = null;

      if (consultor) {
        const [pendente, pago] = await Promise.all([
          prisma.comissao.aggregate({
            where: {
              vendedorId: consultor.id,
              statusPagamento: 'PENDENTE',
            },
            _sum: { valor: true },
          }),
          prisma.comissao.aggregate({
            where: {
              vendedorId: consultor.id,
              statusPagamento: 'PAGO',
            },
            _sum: { valor: true },
          }),
        ]);

        consultorResumo = {
          id: consultor.id,
          nome: consultor.nome,
          valorComissaoIndicacao: consultor.valorComissaoIndicacao ?? 0,
          comissaoPendente: pendente._sum.valor ?? 0,
          comissaoPaga: pago._sum.valor ?? 0,
        };
      }

      res.json({
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: role ? { id: role.id, name: role.name } : null,
        permissions,
        tenant: req.user.tenant,
        consultor: consultorResumo,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Erro ao verificar autenticação' });
    }
  }

  async logout(req: Request, res: Response) {
    res.cookie('auth_token', '', { maxAge: -1 });
    res.json({ message: 'Logout realizado com sucesso' });
  }
}
