import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { ClienteAuthService } from '../services/cliente-auth.service';
import { TitularService } from '../services/titular.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { getPrismaForTenant } from '../utils/prisma';
import { AuthRequest } from '../types/auth';
import jwt from 'jsonwebtoken';
import config from '../config';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class AuthController {
  private logger = new Logger({ service: 'AuthController' });

  async login(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        res.status(400).json({ message: 'Tenant unknown' });
        return;
      }

      const { email, password, login, audience } = req.body ?? {};

      const isClienteFlow = audience === 'cliente' || Boolean(login);

      if (isClienteFlow) {
        const loginValue = String(login ?? email ?? '').trim();
        const senhaValue = String(password ?? '').trim();
        if (!loginValue || !senhaValue) {
          return res.status(400).json({ message: 'Login e senha são obrigatórios' });
        }

        const service = new ClienteAuthService(req.tenantId);
        const { result, code } = await service.login(loginValue, senhaValue);

        if (!result && code === 'FIRST_ACCESS_REQUIRED') {
          return res.status(428).json({
            message: 'Primeiro acesso necessário para definir uma senha.',
            code,
          });
        }

        if (!result) return res.status(401).json({ message: 'Credenciais inválidas' });

        const clienteToken = service.generateClienteJwt({
          titularId: result.titularId,
          tenant: req.tenantId,
          email: result.email,
        });

        res.cookie('cliente_token', clienteToken, {
          httpOnly: true,
          secure: config.server.nodeEnv === 'production',
          sameSite: config.server.nodeEnv === 'production' ? 'none' : 'lax',
          domain: config.server.nodeEnv === 'production' ? '.planvita.com.br' : undefined,
          maxAge: 1000 * 60 * 60 * 24,
        });

        return res.json(result);
      }

      const emailValue = String(email ?? '').trim().toLowerCase();
      const senhaValue = String(password ?? '').trim();
      if (!emailValue || !senhaValue) {
        res.status(400).json({ message: 'Email e senha são obrigatórios' });
        return;
      }

      const service = new AuthService(req.tenantId);
      const user = await service.validateUser(emailValue, senhaValue);
      if (!user) return res.status(401).json({ message: 'Credenciais inválidas' });

      const token = service.generateToken(user);

      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: process.env.NODE_ENV === 'production' ? '.planvita.com.br' : undefined,
        maxAge: 1000 * 60 * 60 * 24, // 1 dia
      });

      return res.json(user);
    } catch (error) {
      this.logger.error('Erro ao realizar login', error);
      res.status(500).json({ message: 'Erro interno no servidor' });
    }
  }

  async register(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const service = new TitularService(req.tenantId);
      const novoTitular = await service.createFull(req.body);

      const auth = new ClienteAuthService(req.tenantId);
      const start = await auth.startFirstAccessByTitularId(novoTitular.id);

      res.status(201).json({
        titularId: novoTitular.id,
        message: 'Cadastro criado. Enviamos um código para validação.',
        start,
      });
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro ao cadastrar.';
      res.status(status).json({
        message,
        ...(error?.code ? { code: error.code } : {}),
        ...(error?.meta ? { meta: error.meta } : {}),
      });
    }
  }

  async verify(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const { loginOrToken, login, token, otp, purpose } = req.body ?? {};

      const purposeValue = String(purpose ?? '').toUpperCase();
      if (!['FIRST_ACCESS', 'RESET_PASSWORD', 'REGISTER'].includes(purposeValue)) {
        return res.status(400).json({ message: 'Purpose inválido.' });
      }

      const otpValue = String(otp ?? '').trim();
      if (!otpValue) return res.status(400).json({ message: 'Código é obrigatório.' });

      const value = String(loginOrToken ?? token ?? login ?? '').trim();
      if (!value) return res.status(400).json({ message: 'Login ou token é obrigatório.' });

      const auth = new ClienteAuthService(req.tenantId);
      const result = await auth.verifyOtp(value, otpValue, purposeValue as any);
      res.json(result);
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro ao validar código.';
      res.status(status).json({ message });
    }
  }

  async firstAccess(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const { verificationToken, password, login, titularId } = req.body ?? {};

      const auth = new ClienteAuthService(req.tenantId);

      if (verificationToken && password) {
        await auth.completeFirstAccess(String(verificationToken), String(password));
        return res.json({ message: 'Senha criada com sucesso.' });
      }

      if (titularId != null) {
        const backofficeToken = (req as any).cookies?.auth_token;
        if (!backofficeToken) {
          return res.status(403).json({ message: 'Ação permitida apenas para admin/consultor autenticado.' });
        }
        try {
          jwt.verify(backofficeToken, config.jwt.secret);
        } catch {
          return res.status(403).json({ message: 'Ação permitida apenas para admin/consultor autenticado.' });
        }

        const start = await auth.startFirstAccessByTitularId(Number(titularId));
        return res.json({ message: 'Enviamos um código para primeiro acesso.', start });
      }

      if (login) {
        const start = await auth.startFirstAccessByLogin(String(login));
        return res.json({ message: 'Enviamos um código para primeiro acesso.', start });
      }

      return res.status(400).json({ message: 'Informe login ou verificationToken+password.' });
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro no primeiro acesso.';
      res.status(status).json({ message });
    }
  }

  async forgotPassword(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const { login } = req.body ?? {};
      if (!login) return res.status(400).json({ message: 'Login é obrigatório.' });

      const auth = new ClienteAuthService(req.tenantId);
      const start = await auth.startForgotPassword(String(login));
      res.json({ message: 'Enviamos um código para recuperação de senha.', start });
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro ao iniciar recuperação de senha.';
      res.status(status).json({ message });
    }
  }

  async resetPassword(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const { verificationToken, token, password } = req.body ?? {};
      const passwordValue = String(password ?? '');
      const tokenValue = String(verificationToken ?? token ?? '').trim();
      if (!tokenValue || !passwordValue) {
        return res.status(400).json({ message: 'Token e senha são obrigatórios.' });
      }

      const auth = new ClienteAuthService(req.tenantId);
      await auth.resetPassword(tokenValue, passwordValue);
      res.json({ message: 'Senha alterada com sucesso.' });
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro ao redefinir senha.';
      res.status(status).json({ message });
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
          percentualComissaoIndicacao: true,
        },
      });

      let consultorResumo: {
        id: number;
        nome: string;
        valorComissaoIndicacao: number;
        percentualComissaoIndicacao: number;
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
          percentualComissaoIndicacao: consultor.percentualComissaoIndicacao ?? 0,
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
    res.cookie('cliente_token', '', { maxAge: -1 });
    res.json({ message: 'Logout realizado com sucesso' });
  }
}
