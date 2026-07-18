import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config';
import { NotificationApiClient, type NotificationChannel } from '../utils/notificationClient';
import { buildStandardEmailTemplate, formatTextAsHtmlParagraphs } from '../utils/emailTemplate';
import { getPrismaForTenant } from '../utils/prisma';

const OTP_TTL_MINUTES = 15;
const TOKEN_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

export type ClienteJwtPayload = {
  titularId: number;
  tenant: string;
  email: string;
};

export type ClienteLoginResult = {
  titularId: number;
  nome: string;
  email: string;
  cpf: string | null;
};

type ClienteAccessIdentity = {
  titularId: number;
  nome: string;
  email: string;
  cpf: string | null;
  telefone: string | null;
  metodoNotificacaoRecorrente?: string | null;
  pagamentoConfirmadoEm?: Date | null;
  source: 'titular' | 'corresponsavel';
};

export type AuthStartResult = {
  channel: NotificationChannel;
  destinationMasked: string;
  dev?: {
    otp?: string;
    token?: string;
  };
};

export type OtpPurpose = 'FIRST_ACCESS' | 'RESET_PASSWORD' | 'REGISTER';

export type VerifyResult = {
  verificationToken: string;
  dev?: {
    verificationToken: string;
  };
};

type TokenType =
  | 'FIRST_ACCESS_LINK'
  | 'RESET_PASSWORD_LINK'
  | 'VERIFY_FIRST_ACCESS'
  | 'VERIFY_RESET_PASSWORD';

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const normalizeCpf = (value: string) => value.replace(/\D/g, '');

const maskEmail = (email: string): string => {
  const [user, domain] = email.split('@');
  if (!user || !domain) return '***';
  const userMasked = user.length <= 2 ? `${user[0] ?? '*'}*` : `${user.slice(0, 2)}***`;
  const domainParts = domain.split('.');
  const domainName = domainParts[0] ?? domain;
  const domainMasked =
    domainName.length <= 2 ? `${domainName[0] ?? '*'}*` : `${domainName.slice(0, 2)}***`;
  const tld = domainParts.slice(1).join('.');
  return `${userMasked}@${domainMasked}${tld ? `.${tld}` : ''}`;
};

const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '***';
  return `${digits.slice(0, 2)}*****${digits.slice(-2)}`;
};

const sha256Hex = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const isStrongPassword = (value: string): boolean => {
  if (typeof value !== 'string') return false;
  if (value.length < 8) return false;
  const hasLetter = /[A-Za-z]/.test(value);
  const hasNumber = /\d/.test(value);
  const hasSpecial = /[^A-Za-z0-9]/.test(value);
  return hasLetter && hasNumber && hasSpecial;
};

export class ClienteAuthService {
  private prisma;
  private notifier: NotificationApiClient;

  constructor(private tenantId: string) {
    this.prisma = getPrismaForTenant(tenantId);
    this.notifier = new NotificationApiClient(tenantId);
  }

  private async reconcilePagamentoConfirmadoEm(
    titularId: number,
    currentValue?: Date | null,
  ): Promise<Date | null> {
    if (currentValue) return currentValue;

    const contaReceberRepo = (this.prisma as any)?.contaReceber;
    if (!contaReceberRepo?.findFirst) return null;

    const contaReceberConfirmada = await contaReceberRepo.findFirst({
      where: {
        clienteId: titularId,
        status: { in: ['RECEBIDO', 'CONFIRMADO'] },
      },
      select: {
        dataRecebimento: true,
        dataVencimento: true,
        vencimento: true,
      },
      orderBy: [{ dataRecebimento: 'asc' }, { id: 'asc' }],
    });

    const pagamentoConfirmadoEm =
      contaReceberConfirmada?.dataRecebimento ??
      contaReceberConfirmada?.dataVencimento ??
      contaReceberConfirmada?.vencimento ??
      null;

    if (!pagamentoConfirmadoEm) return null;

    await this.prisma.titular.update({
      where: { id: titularId },
      data: { pagamentoConfirmadoEm },
    });

    await (this.prisma as any).dependente?.updateMany?.({
      where: { titularId },
      data: { carenciaInicioEm: pagamentoConfirmadoEm },
    });

    return pagamentoConfirmadoEm;
  }

  async login(loginRaw: string, senha: string): Promise<{ result: ClienteLoginResult | null; code?: string }> {
    const identity = await this.findAccessIdentityByLogin(loginRaw);
    if (!identity) return { result: null };

    identity.pagamentoConfirmadoEm = await this.reconcilePagamentoConfirmadoEm(
      identity.titularId,
      identity.pagamentoConfirmadoEm ?? null,
    );

    if (!identity.pagamentoConfirmadoEm) {
      return { result: null, code: 'PAYMENT_REQUIRED' };
    }

    const credential = await (this.prisma as any).titularCredential.findUnique({
      where: { titularId: identity.titularId },
    });

    if (!credential?.senhaHash) {
      return { result: null, code: 'FIRST_ACCESS_REQUIRED' };
    }

    const ok = await bcrypt.compare(senha, credential.senhaHash);
    if (!ok) return { result: null };

    await (this.prisma as any).titularCredential.update({
      where: { titularId: identity.titularId },
      data: { lastLoginAt: new Date() },
    });

    return {
      result: {
        titularId: identity.titularId,
        nome: identity.nome,
        email: identity.email,
        cpf: identity.cpf ?? null,
      },
    };
  }

  async registerAndStartVerification(data: any): Promise<{ titularId: number; start: AuthStartResult }> {
    const titular = await this.prisma.titular.create({
      data: data as any,
    });

    await this.ensureCredential(titular.id);

    const identity: ClienteAccessIdentity = {
      titularId: titular.id,
      nome: titular.nome,
      email: titular.email,
      cpf: titular.cpf ?? null,
      telefone: titular.telefone ?? null,
      metodoNotificacaoRecorrente: titular.metodoNotificacaoRecorrente ?? null,
      pagamentoConfirmadoEm: titular.pagamentoConfirmadoEm ?? null,
      source: 'titular',
    };
    const start = await this.startOtp(
      identity,
      this.resolvePreferredChannel(identity),
      'REGISTER',
    );

    return { titularId: titular.id, start };
  }

  async startFirstAccessByLogin(
    loginRaw: string,
    requestedChannelRaw?: unknown,
  ): Promise<AuthStartResult> {
    const identity = await this.findAccessIdentityByLogin(loginRaw);
    if (!identity) {
      const err: any = new Error('Cliente não encontrado.');
      err.status = 404;
      throw err;
    }

    identity.pagamentoConfirmadoEm = await this.reconcilePagamentoConfirmadoEm(
      identity.titularId,
      identity.pagamentoConfirmadoEm ?? null,
    );

    if (!identity.pagamentoConfirmadoEm) {
      const err: any = new Error('Pagamento ainda não confirmado. Aguarde a confirmação do pagamento para criar sua senha.');
      err.status = 402;
      err.code = 'PAYMENT_REQUIRED';
      throw err;
    }

    await this.ensureCredential(identity.titularId);
    const linkToken = await this.createToken('FIRST_ACCESS_LINK', identity.titularId, 'FIRST_ACCESS');
    const channel = this.resolveChannel(identity, requestedChannelRaw);
    const start = await this.startOtp(identity, channel, 'FIRST_ACCESS', linkToken);
    return start;
  }

  async startFirstAccessByTitularId(
    titularId: number,
    requestedChannelRaw?: unknown,
    bypassPaymentCheck = false,
  ): Promise<AuthStartResult> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: { id: true, email: true, telefone: true, metodoNotificacaoRecorrente: true, pagamentoConfirmadoEm: true },
    });

    if (!titular) {
      const err: any = new Error('Cliente não encontrado.');
      err.status = 404;
      throw err;
    }

    titular.pagamentoConfirmadoEm = await this.reconcilePagamentoConfirmadoEm(
      titular.id,
      titular.pagamentoConfirmadoEm ?? null,
    );

    if (!bypassPaymentCheck && !titular.pagamentoConfirmadoEm) {
      const err: any = new Error('Pagamento ainda não confirmado. Aguarde a confirmação do pagamento para criar sua senha.');
      err.status = 402;
      err.code = 'PAYMENT_REQUIRED';
      throw err;
    }

    await this.ensureCredential(titular.id);
    const linkToken = await this.createToken('FIRST_ACCESS_LINK', titular.id, 'FIRST_ACCESS');
    const channel = this.resolveChannel(titular, requestedChannelRaw);
    const start = await this.startOtp(
      {
        titularId: titular.id,
        nome: '',
        email: titular.email ?? '',
        cpf: null,
        telefone: titular.telefone ?? null,
        metodoNotificacaoRecorrente: titular.metodoNotificacaoRecorrente ?? null,
        pagamentoConfirmadoEm: titular.pagamentoConfirmadoEm ?? null,
        source: 'titular',
      },
      channel,
      'FIRST_ACCESS',
      linkToken,
    );
    return start;
  }

  async startForgotPassword(loginRaw: string): Promise<AuthStartResult> {
    const identity = await this.findAccessIdentityByLogin(loginRaw);
    if (!identity) {
      const err: any = new Error('Cliente não encontrado.');
      err.status = 404;
      throw err;
    }

    await this.ensureCredential(identity.titularId);
    const linkToken = await this.createToken('RESET_PASSWORD_LINK', identity.titularId, 'RESET_PASSWORD');
    const start = await this.startOtp(identity, this.resolvePreferredChannel(identity), 'RESET_PASSWORD', linkToken);
    return start;
  }

  async verifyOtp(loginRawOrToken: string, otp: string, purpose: OtpPurpose): Promise<VerifyResult> {
    const { titularId } = await this.resolveTitularForOtp(loginRawOrToken, purpose);

    const otpRecord = await (this.prisma as any).titularOtp.findFirst({
      where: {
        titularId,
        purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      const err: any = new Error('Código inválido ou expirado.');
      err.status = 400;
      throw err;
    }

    if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
      const err: any = new Error('Muitas tentativas. Solicite um novo código.');
      err.status = 429;
      throw err;
    }

    const ok = await bcrypt.compare(otp, otpRecord.codeHash);
    if (!ok) {
      await (this.prisma as any).titularOtp.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      const err: any = new Error('Código inválido.');
      err.status = 400;
      throw err;
    }

    await (this.prisma as any).titularOtp.update({
      where: { id: otpRecord.id },
      data: { consumedAt: new Date() },
    });

    await this.ensureCredential(titularId);
    const channel = String(otpRecord.channel ?? '').toLowerCase() === 'whatsapp' ? 'whatsapp' : 'email';
    await this.markVerifiedChannel(titularId, channel);

    const tokenType = purpose === 'RESET_PASSWORD' ? 'VERIFY_RESET_PASSWORD' : 'VERIFY_FIRST_ACCESS';
    const verificationToken = await this.createToken(tokenType, titularId, purpose);

    return {
      verificationToken,
      ...(config.server.nodeEnv !== 'production'
        ? { dev: { verificationToken } }
        : {}),
    };
  }

  async completeFirstAccess(verificationTokenOrLinkToken: string, password: string): Promise<void> {
    if (!isStrongPassword(password)) {
      const err: any = new Error(
        'Senha fraca. Use no mínimo 8 caracteres com letra, número e caractere especial.',
      );
      err.status = 400;
      throw err;
    }

    const token =
      (await this.findTokenByRaw('VERIFY_FIRST_ACCESS', verificationTokenOrLinkToken)) ??
      (await this.findTokenByRaw('FIRST_ACCESS_LINK', verificationTokenOrLinkToken));

    if (!token) {
      const err: any = new Error('Token inválido ou expirado.');
      err.status = 400;
      throw err;
    }

    const titular = await this.prisma.titular.findUnique({
      where: { id: token.titularId },
      select: { pagamentoConfirmadoEm: true },
    });

    if (!titular?.pagamentoConfirmadoEm) {
      const err: any = new Error('Pagamento ainda não confirmado. Aguarde a confirmação do pagamento para criar sua senha.');
      err.status = 402;
      err.code = 'PAYMENT_REQUIRED';
      throw err;
    }

    const senhaHash = await bcrypt.hash(password, 10);
    await this.ensureCredential(token.titularId);
    await (this.prisma as any).titularCredential.update({
      where: { titularId: token.titularId },
      data: { senhaHash },
    });

    await this.consumeTokenById(token.id);
  }

  async resetPassword(verificationTokenOrLinkToken: string, password: string): Promise<void> {
    if (!isStrongPassword(password)) {
      const err: any = new Error(
        'Senha fraca. Use no mínimo 8 caracteres com letra, número e caractere especial.',
      );
      err.status = 400;
      throw err;
    }

    const token =
      (await this.findTokenByRaw('VERIFY_RESET_PASSWORD', verificationTokenOrLinkToken)) ??
      (await this.findTokenByRaw('RESET_PASSWORD_LINK', verificationTokenOrLinkToken));

    if (!token) {
      const err: any = new Error('Token inválido ou expirado.');
      err.status = 400;
      throw err;
    }

    const senhaHash = await bcrypt.hash(password, 10);
    await this.ensureCredential(token.titularId);
    await (this.prisma as any).titularCredential.update({
      where: { titularId: token.titularId },
      data: { senhaHash },
    });

    await this.consumeTokenById(token.id);
  }

  async changePassword(
    titularId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!currentPassword || !newPassword) {
      const err: any = new Error('Senha atual e nova senha são obrigatórias.');
      err.status = 400;
      throw err;
    }

    if (!isStrongPassword(newPassword)) {
      const err: any = new Error(
        'Senha fraca. Use no mínimo 8 caracteres com letra, número e caractere especial.',
      );
      err.status = 400;
      throw err;
    }

    const credential = await (this.prisma as any).titularCredential.findUnique({
      where: { titularId },
      select: { senhaHash: true },
    });

    if (!credential?.senhaHash) {
      const err: any = new Error('Credenciais inválidas.');
      err.status = 401;
      throw err;
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, credential.senhaHash);
    if (!isCurrentPasswordValid) {
      const err: any = new Error('Credenciais inválidas.');
      err.status = 401;
      throw err;
    }

    const senhaHash = await bcrypt.hash(newPassword, 10);
    await (this.prisma as any).titularCredential.update({
      where: { titularId },
      data: { senhaHash },
    });
  }

  async getTitularFull(titularId: number): Promise<any | null> {
    return this.prisma.titular.findUnique({
      where: { id: titularId },
      include: {
        plano: { include: { coberturas: true } },
        dependentes: true,
        corresponsaveis: true,
      } as any,
    });
  }

  generateClienteJwt(payload: ClienteJwtPayload): string {
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.clienteExpiresIn,
    });
  }

  private async findAccessIdentityByLogin(loginRaw: string): Promise<ClienteAccessIdentity | null> {
    const login = String(loginRaw ?? '').trim().toLowerCase();
    if (!login) return null;

    if (isEmail(login)) {
      const titular = await this.prisma.titular.findUnique({
        where: { email: login },
        select: { id: true, nome: true, email: true, cpf: true, telefone: true, metodoNotificacaoRecorrente: true, pagamentoConfirmadoEm: true },
      });
      if (titular) {
        return {
          titularId: titular.id,
          nome: titular.nome,
          email: titular.email,
          cpf: titular.cpf ?? null,
          telefone: titular.telefone ?? null,
          metodoNotificacaoRecorrente: titular.metodoNotificacaoRecorrente ?? null,
          pagamentoConfirmadoEm: titular.pagamentoConfirmadoEm ?? null,
          source: 'titular',
        };
      }

      const corresponsavel = await (this.prisma as any).corresponsavel.findFirst({
        where: { email: login },
        select: {
          nome: true,
          email: true,
          cpf: true,
          telefone: true,
          titular: {
            select: {
              id: true,
              nome: true,
              email: true,
              cpf: true,
              pagamentoConfirmadoEm: true,
              metodoNotificacaoRecorrente: true,
            },
          },
        },
      });
      if (!corresponsavel?.titular) return null;
      return {
        titularId: corresponsavel.titular.id,
        nome: corresponsavel.titular.nome,
        email: corresponsavel.titular.email,
        cpf: corresponsavel.titular.cpf ?? null,
        telefone: corresponsavel.telefone ?? null,
        metodoNotificacaoRecorrente: corresponsavel.titular.metodoNotificacaoRecorrente ?? null,
        pagamentoConfirmadoEm: corresponsavel.titular.pagamentoConfirmadoEm ?? null,
        source: 'corresponsavel',
      };
    }

    const cpf = normalizeCpf(login);
    if (cpf.length === 11) {
      const titular = await this.prisma.titular.findFirst({
        where: { cpf },
        select: { id: true, nome: true, email: true, cpf: true, telefone: true, metodoNotificacaoRecorrente: true, pagamentoConfirmadoEm: true },
      });
      if (titular) {
        return {
          titularId: titular.id,
          nome: titular.nome,
          email: titular.email,
          cpf: titular.cpf ?? null,
          telefone: titular.telefone ?? null,
          metodoNotificacaoRecorrente: titular.metodoNotificacaoRecorrente ?? null,
          pagamentoConfirmadoEm: titular.pagamentoConfirmadoEm ?? null,
          source: 'titular',
        };
      }

      const corresponsavel = await (this.prisma as any).corresponsavel.findFirst({
        where: { cpf },
        select: {
          nome: true,
          email: true,
          cpf: true,
          telefone: true,
          titular: {
            select: {
              id: true,
              nome: true,
              email: true,
              cpf: true,
              pagamentoConfirmadoEm: true,
              metodoNotificacaoRecorrente: true,
            },
          },
        },
      });
      if (!corresponsavel?.titular) return null;
      return {
        titularId: corresponsavel.titular.id,
        nome: corresponsavel.titular.nome,
        email: corresponsavel.titular.email,
        cpf: corresponsavel.titular.cpf ?? null,
        telefone: corresponsavel.telefone ?? null,
        metodoNotificacaoRecorrente: corresponsavel.titular.metodoNotificacaoRecorrente ?? null,
        pagamentoConfirmadoEm: corresponsavel.titular.pagamentoConfirmadoEm ?? null,
        source: 'corresponsavel',
      };
    }

    return null;
  }

  private resolvePreferredChannel(identity: { email?: string | null; telefone?: string | null; metodoNotificacaoRecorrente?: string | null }): NotificationChannel {
    const preferred = String(identity.metodoNotificacaoRecorrente ?? '').toLowerCase();
    const canWhatsapp = Boolean(identity.telefone && identity.telefone.trim().length >= 8);
    const canEmail = Boolean(identity.email && identity.email.includes('@'));
    if (preferred === 'whatsapp' && canWhatsapp) return 'whatsapp';
    if (preferred === 'email' && canEmail) return 'email';
    if (canEmail) return 'email';
    return canWhatsapp ? 'whatsapp' : config.notification.defaultMethod;
  }

  private resolveChannel(
    identity: { email?: string | null; telefone?: string | null; metodoNotificacaoRecorrente?: string | null },
    requestedChannelRaw?: unknown,
  ): NotificationChannel {
    const requestedChannel = String(requestedChannelRaw ?? '').trim().toLowerCase();
    const canWhatsapp = Boolean(identity.telefone && identity.telefone.trim().length >= 8);
    const canEmail = Boolean(identity.email && identity.email.includes('@'));

    if (!requestedChannel) {
      return this.resolvePreferredChannel(identity);
    }

    if (requestedChannel === 'whatsapp') {
      if (!canWhatsapp) {
        const err: any = new Error('Não há telefone válido para envio via WhatsApp.');
        err.status = 400;
        throw err;
      }
      return 'whatsapp';
    }

    if (requestedChannel === 'email') {
      if (!canEmail) {
        const err: any = new Error('Não há e-mail válido para envio.');
        err.status = 400;
        throw err;
      }
      return 'email';
    }

    const err: any = new Error('Canal inválido. Use "email" ou "whatsapp".');
    err.status = 400;
    throw err;
  }

  private async ensureCredential(titularId: number) {
    await (this.prisma as any).titularCredential.upsert({
      where: { titularId },
      update: {},
      create: { titularId },
    });
  }

  private async startOtp(
    identity: ClienteAccessIdentity,
    channel: NotificationChannel,
    purpose: OtpPurpose,
    linkToken?: string,
  ): Promise<AuthStartResult> {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await (this.prisma as any).titularOtp.create({
      data: {
        titularId: identity.titularId,
        channel,
        purpose,
        codeHash,
        expiresAt,
      },
    });

    const destination =
      channel === 'email' ? String(identity.email ?? '') : String(identity.telefone ?? '');
    const destinationMasked = channel === 'email' ? maskEmail(destination) : maskPhone(destination);

    const messageParts = [
      `Seu código de verificação é: ${otp}`,
      `Ele expira em ${OTP_TTL_MINUTES} minutos.`,
    ];
    if (linkToken) {
      messageParts.push(`Link: ${this.buildPublicLink(purpose, linkToken)}`);
    }

    const subject = purpose === 'RESET_PASSWORD' ? 'Recuperação de senha' : 'Verificação de cadastro';
    const message = messageParts.join('\n');

    await this.notifier.send({
      to: destination,
      channel,
      subject,
      message,
      ...(channel === 'email'
        ? {
            html: this.buildAuthEmailHtml({
              nome: identity.nome,
              otp,
              purpose,
              link: linkToken ? this.buildPublicLink(purpose, linkToken) : undefined,
            }),
          }
        : {}),
      metadata: { purpose, tenant: this.tenantId },
    });

    return {
      channel,
      destinationMasked,
      ...(config.server.nodeEnv !== 'production' ? { dev: { otp, token: linkToken } } : {}),
    };
  }

  private buildPublicLink(purpose: OtpPurpose | 'RESET_PASSWORD', token: string): string {
    const base = (process.env.FRONTEND_BASE_URL || '').replace(/\/$/, '') || 'https://planvita.com.br';
    const path =
      purpose === 'RESET_PASSWORD'
        ? '/cliente?modo=reset'
        : '/cliente?modo=primeiro-acesso';
    const url = new URL(`${base}${path}`);
    url.searchParams.set('token', token);
    url.searchParams.set('tenant', this.tenantId);
    return url.toString();
  }

  private buildAuthEmailHtml({
    nome,
    otp,
    purpose,
    link,
  }: {
    nome: string;
    otp: string;
    purpose: OtpPurpose;
    link?: string;
  }) {
    const primeiroNome = (nome || 'cliente').split(' ')[0];
    const intro =
      purpose === 'RESET_PASSWORD'
        ? 'Recebemos uma solicitação para redefinir sua senha. Use o código abaixo para continuar.'
        : 'Use o código abaixo para validar seu acesso e continuar o cadastro.';

    const sections = [
      {
        html: `
          <div style="margin:0 0 24px;padding:18px;border-radius:14px;background:#f3f7f3;border:1px solid #d9e7d9;text-align:center;">
            <p style="margin:0 0 8px;font-size:13px;color:#5f6b5f;">Código de verificação</p>
            <p style="margin:0;font-size:32px;font-weight:800;letter-spacing:6px;color:#2d7a1f;">${otp}</p>
          </div>
        `,
      },
      {
        html: formatTextAsHtmlParagraphs(`Olá, ${primeiroNome}.\n\nEsse código expira em ${OTP_TTL_MINUTES} minutos.`),
      },
    ];

    if (link) {
      sections.push({
        html: formatTextAsHtmlParagraphs('Se preferir, você também pode continuar pelo link abaixo.'),
      });
    }

    return buildStandardEmailTemplate({
      title: purpose === 'RESET_PASSWORD' ? 'Recuperação de senha' : 'Verificação de cadastro',
      intro,
      sections,
      cta: link
        ? {
            label: 'Continuar acesso',
            href: link,
          }
        : undefined,
      footerNote:
        'Se você não reconhece esta solicitação, ignore este e-mail. Nenhuma alteração será feita sem validação.',
    });
  }

  private async resolveTitularForOtp(loginOrToken: string, purpose: OtpPurpose): Promise<{ titularId: number }> {
    const value = String(loginOrToken ?? '').trim();
    const isLikelyToken = value.length >= 32 && value.includes('-');
    if (isLikelyToken) {
      const tokenType = purpose === 'RESET_PASSWORD' ? 'RESET_PASSWORD_LINK' : 'FIRST_ACCESS_LINK';
      const token = await this.findTokenByRaw(tokenType, value);
      if (!token) {
        const err: any = new Error('Token inválido ou expirado.');
        err.status = 400;
        throw err;
      }

      const titular = await this.prisma.titular.findUnique({
        where: { id: token.titularId },
        select: { id: true },
      });
      if (!titular) {
        const err: any = new Error('Cliente não encontrado.');
        err.status = 404;
        throw err;
      }
      return { titularId: token.titularId };
    }

    const identity = await this.findAccessIdentityByLogin(value);
    if (!identity) {
      const err: any = new Error('Cliente não encontrado.');
      err.status = 404;
      throw err;
    }
    return { titularId: identity.titularId };
  }

  private async markVerifiedChannel(titularId: number, channel: NotificationChannel) {
    await (this.prisma as any).titularCredential.update({
      where: { titularId },
      data: channel === 'email' ? { emailVerified: true } : { whatsappVerified: true },
    });
  }

  private async createToken(type: TokenType, titularId: number, purpose?: string): Promise<string> {
    const raw = crypto.randomUUID();
    const tokenHash = sha256Hex(raw);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

    await (this.prisma as any).titularToken.create({
      data: {
        titularId,
        type,
        purpose: purpose ?? null,
        tokenHash,
        expiresAt,
      },
    });

    return raw;
  }

  private async findTokenByRaw(type: TokenType, raw: string): Promise<{ id: string; titularId: number } | null> {
    const tokenHash = sha256Hex(raw);
    const record = await (this.prisma as any).titularToken.findFirst({
      where: {
        tokenHash,
        type,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, titularId: true },
    });
    return record ?? null;
  }

  private async consumeTokenByRaw(type: TokenType, raw: string): Promise<{ id: string; titularId: number }> {
    const tokenHash = sha256Hex(raw);
    const record = await (this.prisma as any).titularToken.findFirst({
      where: {
        tokenHash,
        type,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, titularId: true },
    });

    if (!record) {
      const err: any = new Error('Token inválido ou expirado.');
      err.status = 400;
      throw err;
    }

    await (this.prisma as any).titularToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return record;
  }

  private async consumeTokenById(id: string): Promise<void> {
    const updated = await (this.prisma as any).titularToken.updateMany({
      where: {
        id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });

    if (!updated?.count) {
      const err: any = new Error('Token inválido ou expirado.');
      err.status = 400;
      throw err;
    }
  }

}
