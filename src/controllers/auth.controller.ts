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
import { normalizeTenantId } from '../utils/tenants';
import { resolveWhatsappClientForSending } from '../services/whatsapp-client.service';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class AuthController {
  private logger = new Logger({ service: 'AuthController' });
  private readonly clienteTenantFallback = ['lider', 'pax', 'bosque'];

  private getCookieDomain(req: Request): string | undefined {
    if (config.server.nodeEnv !== 'production') return undefined;

    const forwardedHost = req.headers['x-forwarded-host'];
    const rawHost =
      (typeof forwardedHost === 'string' && forwardedHost) ||
      req.headers.host ||
      '';
    const hostname = rawHost.split(',')[0]?.trim().split(':')[0]?.toLowerCase();

    if (!hostname || hostname === 'localhost') return undefined;

    const parts = hostname.split('.');
    if (parts.length < 2) return undefined;

    const baseDomain =
      parts.length >= 3 && parts.slice(-2).join('.') === 'com.br'
        ? parts.slice(-3).join('.')
        : parts.slice(-2).join('.');

    return `.${baseDomain}`;
  }

  private resolveRequestIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded;
    if (Array.isArray(forwarded) && forwarded[0]?.trim()) return forwarded[0];
    return req.socket?.remoteAddress ?? null;
  }

  private getClienteTenantCookieOptions(req: Request) {
    const isProd = config.server.nodeEnv === 'production';
    return {
      httpOnly: false as const,
      secure: isProd,
      sameSite: 'lax' as const,
      domain: this.getCookieDomain(req),
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

  private getClienteCookieOptions(req: Request) {
    const isProd = config.server.nodeEnv === 'production';
    return {
      httpOnly: true as const,
      secure: isProd,
      sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
      domain: this.getCookieDomain(req),
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

            if (!result && code === 'CORRESPONSAVEL_OTP_REQUIRED') {
              return res.status(401).json({
                message:
                  'Senha incorreta para este corresponsável. Valide seu acesso com um código enviado ao seu e-mail ou WhatsApp.',
                code: 'CORRESPONSAVEL_OTP_REQUIRED',
                tenant,
              });
            }

            if (!result) continue;

            const clienteToken = service.generateClienteJwt({
              titularId: result.titularId,
              tenant,
              email: result.email,
            });

            res.cookie('cliente_token', clienteToken, this.getClienteCookieOptions(req));
            res.cookie('tenant', tenant, this.getClienteTenantCookieOptions(req));

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

      const cookieDomain = this.getCookieDomain(req);
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        domain: cookieDomain,
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
      const targetTenant =
        normalizeTenantId(req.body?.targetTenantId) ||
        normalizeTenantId(req.body?.consultorTenantId) ||
        normalizeTenantId(typeof req.query?.tenant === 'string' ? req.query.tenant : null) ||
        normalizeTenantId(req.tenantId);

      if (!targetTenant) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new TitularService(targetTenant);
      const novoTitular = await service.createFull(req.body, {
        requestIp: this.resolveRequestIp(req),
        requireConsents: true,
        consentOrigin: 'auth_register',
      });

      const auth = new ClienteAuthService(targetTenant);
      let start: Awaited<ReturnType<ClienteAuthService['startFirstAccessByTitularId']>> | null = null;
      let paymentPending = false;

      try {
        start = await auth.startFirstAccessByTitularId(novoTitular.titular.id);
      } catch (error: any) {
        if (error?.code === 'PAYMENT_REQUIRED' || error?.status === 402) {
          paymentPending = true;
          this.logger.info('Cadastro concluído com pagamento pendente; primeiro acesso adiado', {
            tenant: targetTenant,
            titularId: novoTitular.titular.id,
          });
        } else {
          throw error;
        }
      }

      res.cookie('tenant', targetTenant, this.getClienteTenantCookieOptions(req));

      res.status(201).json({
        titularId: novoTitular.titular.id,
        tenant: targetTenant,
        message: paymentPending
          ? 'Cadastro criado. Verifique o SMS ou Email para acessar a cobrança e concluir o pagamento.'
          : 'Cadastro criado. Enviamos um código para validação.',
        start,
        paymentPending,
        recurring: novoTitular.recurring,
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
      if (!['FIRST_ACCESS', 'RESET_PASSWORD', 'REGISTER', 'LOGIN_ACCESS'].includes(purposeValue)) {
        return res.status(400).json({ message: 'Purpose inválido.' });
      }

      const otpValue = String(otp ?? '').trim();
      if (!otpValue) return res.status(400).json({ message: 'Código é obrigatório.' });

      const value = String(loginOrToken ?? token ?? login ?? '').trim();
      if (!value) return res.status(400).json({ message: 'Login ou token é obrigatório.' });

      const auth = new ClienteAuthService(req.tenantId);
      if (purposeValue === 'LOGIN_ACCESS') {
        const loginValue = String(login ?? '').trim();
        if (!loginValue) return res.status(400).json({ message: 'Login é obrigatório.' });

        const result = await auth.loginCorresponsavelWithOtp(loginValue, otpValue);
        const clienteToken = auth.generateClienteJwt({
          titularId: result.titularId,
          tenant: req.tenantId,
          email: result.email,
        });

        res.cookie('cliente_token', clienteToken, this.getClienteCookieOptions(req));
        res.cookie('tenant', req.tenantId, this.getClienteTenantCookieOptions(req));
        return res.json(result);
      }

      const result = await auth.verifyOtp(value, otpValue, purposeValue as any);
      res.json(result);
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro ao validar código.';
      res.status(status).json({
        message,
        ...(error?.code ? { code: error.code } : {}),
        ...(typeof error?.retryAfterSeconds === 'number'
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      });
    }
  }

  async firstAccess(req: TenantRequest, res: Response) {
    try {
      const { verificationToken, token, password, login, titularId, channel } = req.body ?? {};

      const tokenValue = String(verificationToken ?? token ?? '').trim();
      if (tokenValue && password) {
        if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
        const auth = new ClienteAuthService(req.tenantId);
        await auth.completeFirstAccess(tokenValue, String(password));
        return res.json({ message: 'Senha criada com sucesso.' });
      }

      if (titularId != null) {
        if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
        const auth = new ClienteAuthService(req.tenantId);
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
        // Primeiro acesso é público: um cookie de tenant antigo não pode impedir
        // que o cliente seja encontrado em outra base configurada.
        let deferredError: any = null;
        for (const tenant of this.getClienteTenantCandidates()) {
          try {
            const auth = new ClienteAuthService(tenant);
            const start = await auth.startFirstAccessByLogin(String(login), channel);
            res.cookie('tenant', tenant, this.getClienteTenantCookieOptions(req));
            return res.json({
              message: 'Enviamos um código para primeiro acesso.',
              tenant,
              start,
            });
          } catch (error: any) {
            // Ausência no tenant atual é esperada; continue procurando nas demais bases.
            if (error?.status === 404) continue;

            // Ex.: pagamento pendente. Preserve o erro, mas continue em caso de
            // cadastros distintos com o mesmo CPF/e-mail em outro tenant.
            deferredError ??= error;
          }
        }

        if (deferredError) throw deferredError;

        const error: any = new Error('Cliente não encontrado.');
        error.status = 404;
        throw error;
      }

      return res.status(400).json({ message: 'Informe login ou token+password.' });
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro no primeiro acesso.';
      res.status(status).json({
        message,
        ...(error?.code ? { code: error.code } : {}),
        ...(typeof error?.retryAfterSeconds === 'number'
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      });
    }
  }

  async firstAccessChannels(req: TenantRequest, res: Response) {
    const normalizedTenant = normalizeTenantId(req.tenantId) ?? undefined;

    try {
      const { tenant, client } = await resolveWhatsappClientForSending(normalizedTenant);
      const status = await client.getQrStatus(250);
      return res.json({
        email: true,
        whatsapp: Boolean(status.ready || client.isReady()),
        activeTenant: status.ready || client.isReady() ? tenant : null,
      });
    } catch (error) {
      this.logger.warn('Falha ao verificar disponibilidade da sessão compartilhada de WhatsApp', {
        tenant: normalizedTenant ?? null,
        reason: (error as Error)?.message,
      });
      return res.json({
        email: true,
        whatsapp: false,
        activeTenant: null,
      });
    }
  }

  async forgotPassword(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const { login, channel } = req.body ?? {};
      if (!login) return res.status(400).json({ message: 'Login é obrigatório.' });

      const auth = new ClienteAuthService(req.tenantId);
      const start = await auth.startForgotPassword(String(login), channel);
      res.json({ message: 'Enviamos um código para recuperação de senha.', start });
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error?.message ?? 'Erro ao iniciar recuperação de senha.';
      res.status(status).json({
        message,
        ...(error?.code ? { code: error.code } : {}),
        ...(typeof error?.retryAfterSeconds === 'number'
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      });
    }
  }

  async corresponsavelAccess(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const { login, channel } = req.body ?? {};
      if (!login) return res.status(400).json({ message: 'Login é obrigatório.' });

      const auth = new ClienteAuthService(req.tenantId);
      const start = await auth.startCorresponsavelAccess(String(login), channel);
      res.json({ message: 'Enviamos um código para validar o acesso do corresponsável.', start });
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message =
        error?.message ?? 'Erro ao iniciar validação de acesso do corresponsável.';
      res.status(status).json({
        message,
        ...(error?.code ? { code: error.code } : {}),
        ...(typeof error?.retryAfterSeconds === 'number'
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      });
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
      res.status(status).json({
        message,
        ...(error?.code ? { code: error.code } : {}),
        ...(typeof error?.retryAfterSeconds === 'number'
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      });
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
    const domain = this.getCookieDomain(req);

    res.cookie('auth_token', '', { maxAge: -1, path: '/', domain });
    res.cookie('cliente_token', '', {
      ...this.getClienteCookieOptions(req),
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
