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
import { ClienteAuthRequest } from '../middlewares/cliente-auth.middleware';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class AuthController {
  private logger = new Logger({ service: 'AuthController' });
  private readonly clienteTenantFallback = ['lider', 'pax', 'bosque'];

  private getClienteTenantCookieOptions() {
    const isProd = config.server.nodeEnv === 'production';
    return {
      httpOnly: false as const,
      secure: isProd,
      sameSite: 'lax' as const,
      domain: isProd ? '.planvita.com.br' : undefined,
      maxAge: 1000 * 60 * 60 * 24 * 30,
      path: '/',
    };
  }

  private getClienteTenantCandidates(currentTenant?: string): string[] {
    const preferred = String(currentTenant ?? '').trim().toLowerCase();
    const ordered = preferred
      ? [preferred, ...this.clienteTenantFallback]
      : [...this.clienteTenantFallback];
    return Array.from(new Set(ordered));
  }

  private getClienteCookieOptions() {
    const isProd = config.server.nodeEnv === 'production';
    return {
      httpOnly: true as const,
      secure: isProd,
      sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
      domain: isProd ? '.planvita.com.br' : undefined,
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 dias (sessão cliente)
      path: '/',
    };
  }

  async login(req: TenantRequest, res: Response) {
    try {
      const { email, password, login, audience } = req.body ?? {};

      const isClienteFlow = audience === 'cliente' || Boolean(login);

      if (isClienteFlow) {
        const loginValue = String(login ?? email ?? '').trim();
        const senhaValue = String(password ?? '').trim();
        if (!loginValue || !senhaValue) {
          return res.status(400).json({ message: 'Login e senha são obrigatórios' });
        }

        const tenantsToTry = this.getClienteTenantCandidates(req.tenantId);
        let firstAccessTenant: string | null = null;

        for (const tenant of tenantsToTry) {
          try {
            const service = new ClienteAuthService(tenant);
            const { result, code } = await service.login(loginValue, senhaValue);

            if (!result && code === 'PAYMENT_REQUIRED') {
              return res.status(402).json({
                message: 'Pagamento ainda não confirmado. Aguarde a confirmação do pagamento para acessar o aplicativo.',
                code: 'PAYMENT_REQUIRED',
              });
            }

            if (!result && code === 'FIRST_ACCESS_REQUIRED') {
              firstAccessTenant = tenant;
              continue;
            }

            if (!result) continue;

            const clienteToken = service.generateClienteJwt({
              titularId: result.titularId,
              tenant,
              email: result.email,
            });

            res.cookie('cliente_token', clienteToken, this.getClienteCookieOptions());
            res.cookie('tenant', tenant, this.getClienteTenantCookieOptions());

            return res.json(result);
          } catch (error) {
            this.logger.warn('Falha ao tentar login do cliente em tenant', {
              tenant,
              reason: (error as Error)?.message,
            });
          }
        }

        if (firstAccessTenant) {
          return res.status(428).json({
            message: 'Primeiro acesso necessário para definir uma senha.',
            code: 'FIRST_ACCESS_REQUIRED',
            tenant: firstAccessTenant,
          });
        }

        return res.status(401).json({ message: 'Credenciais inválidas' });
      }

      if (!req.tenantId) {
        res.status(400).json({ message: 'Tenant unknown' });
        return;
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

      return res.json({ ...user, token });
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
      const { verificationToken, token, password, login, titularId, channel } = req.body ?? {};

      const auth = new ClienteAuthService(req.tenantId);

      const tokenValue = String(verificationToken ?? token ?? '').trim();
      if (tokenValue && password) {
        await auth.completeFirstAccess(tokenValue, String(password));
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

        const start = await auth.startFirstAccessByTitularId(Number(titularId), channel, true);
        return res.json({ message: 'Enviamos um código para primeiro acesso.', start });
      }

      if (login) {
        const start = await auth.startFirstAccessByLogin(String(login), channel);
        return res.json({ message: 'Enviamos um código para primeiro acesso.', start });
      }

      return res.status(400).json({ message: 'Informe login ou token+password.' });
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

  async changeClientePassword(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const titularId = Number(req?.cliente?.titularId);
      if (!titularId || Number.isNaN(titularId)) {
        return res.status(401).json({ message: 'Não autenticado' });
      }

      const { currentPassword, newPassword } = req.body ?? {};
      const auth = new ClienteAuthService(req.tenantId);
      await auth.changePassword(titularId, String(currentPassword ?? ''), String(newPassword ?? ''));
      res.json({ message: 'Senha alterada com sucesso.' });
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro ao alterar senha.';
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
    const isProd = config.server.nodeEnv === 'production';
    const domain = isProd ? '.planvita.com.br' : undefined;

    res.cookie('auth_token', '', { maxAge: -1, path: '/', domain });
    res.cookie('cliente_token', '', {
      ...this.getClienteCookieOptions(),
      maxAge: -1,
    });
    res.json({ message: 'Logout realizado com sucesso' });
  }

  async reenviarLinkPagamento(req: TenantRequest, res: Response) {
    try {
      const { login } = req.body ?? {};
      if (!login) return res.status(400).json({ message: 'Login (CPF ou e-mail) é obrigatório.' });

      const tenantsToTry = this.getClienteTenantCandidates(req.tenantId);

      for (const tenant of tenantsToTry) {
        try {
          const { getPrismaForTenant } = await import('../utils/prisma');
          const prisma = getPrismaForTenant(tenant);

          const loginValue = String(login).trim().toLowerCase();
          const isCpf = /^\d{11}$/.test(loginValue.replace(/\D/g, ''));

          const where = isCpf
            ? { cpf: loginValue.replace(/\D/g, '') }
            : { email: loginValue };

          const titular = await prisma.titular.findFirst({
            where,
            select: {
              id: true,
              nome: true,
              email: true,
              telefone: true,
              cpf: true,
              pagamentoConfirmadoEm: true,
              plano: { select: { valorMensal: true } },
              contasReceber: {
                where: { status: 'PENDENTE' },
                orderBy: { vencimento: 'asc' },
                take: 1,
                select: { paymentUrl: true, pixQrCode: true, asaasPaymentId: true, vencimento: true, valor: true },
              },
            },
          });

          if (!titular) continue;

          if (titular.pagamentoConfirmadoEm) {
            return res.status(409).json({
              message: 'Pagamento já confirmado para este cadastro.',
              code: 'PAYMENT_ALREADY_CONFIRMED',
            });
          }

          const contaPendente = titular.contasReceber[0] ?? null;
          let paymentUrl: string | null = contaPendente?.paymentUrl ?? null;

          if (!paymentUrl) {
            const { AsaasIntegrationService } = await import('../services/asaas-integration.service');
            const asaas = new AsaasIntegrationService(tenant);
            if (asaas.isEnabled()) {
              paymentUrl = await asaas.reenviarLinkCobrancaPendente(titular.id) ?? null;
            }
          }

          const masked = (v: string | null | undefined): string | null => {
            if (!v) return null;
            if (v.includes('@')) {
              const [u, d] = v.split('@');
              return `${u.slice(0, 2)}***@${d}`;
            }
            return `****${v.slice(-4)}`;
          };

          return res.json({
            nome: titular.nome,
            emailMasked: masked(titular.email),
            telefoneMasked: masked(titular.telefone),
            paymentUrl,
            vencimento: contaPendente?.vencimento ?? null,
            valor: contaPendente?.valor ?? titular.plano?.valorMensal ?? null,
          });
        } catch (innerError: any) {
          this.logger.warn('Falha ao tentar reenviar link de pagamento em tenant', {
            tenant,
            error: innerError?.message,
          });
        }
      }

      return res.status(404).json({ message: 'Cadastro não encontrado.' });
    } catch (error) {
      this.logger.error('Erro ao reenviar link de pagamento', error);
      res.status(500).json({ message: 'Erro interno no servidor' });
    }
  }

  async reenviarLinkContrato(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const titularId = Number((req as any)?.cliente?.titularId);
      if (!titularId || Number.isNaN(titularId)) {
        return res.status(401).json({ message: 'Não autenticado' });
      }

      const { channel } = req.body ?? {};
      const channelValue = String(channel ?? '').trim().toLowerCase();
      if (channelValue !== 'email' && channelValue !== 'whatsapp') {
        return res.status(400).json({ message: 'Canal inválido. Use "email" ou "whatsapp".' });
      }

      const auth = new ClienteAuthService(req.tenantId);
      const start = await auth.startFirstAccessByTitularId(titularId, channelValue, true);

      res.json({
        message: `Link de acesso ao contrato enviado via ${channelValue}.`,
        channel: start.channel,
        destinationMasked: start.destinationMasked,
      });
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro ao reenviar link de contrato.';
      res.status(status).json({ message });
    }
  }
}
