import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config';
import { NotificationApiClient, type NotificationChannel } from '../utils/notificationClient';
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

  async login(loginRaw: string, senha: string): Promise<{ result: ClienteLoginResult | null; code?: string }> {
    const titular = await this.findTitularByLogin(loginRaw);
    if (!titular) return { result: null };

    const credential = await (this.prisma as any).titularCredential.findUnique({
      where: { titularId: titular.id },
    });

    if (!credential?.senhaHash) {
      return { result: null, code: 'FIRST_ACCESS_REQUIRED' };
    }

    const ok = await bcrypt.compare(senha, credential.senhaHash);
    if (!ok) return { result: null };

    await (this.prisma as any).titularCredential.update({
      where: { titularId: titular.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      result: {
        titularId: titular.id,
        nome: titular.nome,
        email: titular.email,
        cpf: titular.cpf ?? null,
      },
    };
  }

  async registerAndStartVerification(data: any): Promise<{ titularId: number; start: AuthStartResult }> {
    const titular = await this.prisma.titular.create({
      data: data as any,
    });

    await this.ensureCredential(titular.id);

    const start = await this.startOtp(titular.id, this.resolvePreferredChannel(titular), 'REGISTER');

    return { titularId: titular.id, start };
  }

  async startFirstAccessByLogin(loginRaw: string): Promise<AuthStartResult> {
    const titular = await this.findTitularByLogin(loginRaw);
    if (!titular) {
      const err: any = new Error('Cliente não encontrado.');
      err.status = 404;
      throw err;
    }

    await this.ensureCredential(titular.id);
    const linkToken = await this.createToken('FIRST_ACCESS_LINK', titular.id, 'FIRST_ACCESS');
    const start = await this.startOtp(titular.id, this.resolvePreferredChannel(titular), 'FIRST_ACCESS', linkToken);
    return start;
  }

  async startFirstAccessByTitularId(titularId: number): Promise<AuthStartResult> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: { id: true, email: true, telefone: true, metodoNotificacaoRecorrente: true },
    });

    if (!titular) {
      const err: any = new Error('Cliente não encontrado.');
      err.status = 404;
      throw err;
    }

    await this.ensureCredential(titular.id);
    const linkToken = await this.createToken('FIRST_ACCESS_LINK', titular.id, 'FIRST_ACCESS');
    const start = await this.startOtp(titular.id, this.resolvePreferredChannel(titular), 'FIRST_ACCESS', linkToken);
    return start;
  }

  async startForgotPassword(loginRaw: string): Promise<AuthStartResult> {
    const titular = await this.findTitularByLogin(loginRaw);
    if (!titular) {
      const err: any = new Error('Cliente não encontrado.');
      err.status = 404;
      throw err;
    }

    await this.ensureCredential(titular.id);
    const linkToken = await this.createToken('RESET_PASSWORD_LINK', titular.id, 'RESET_PASSWORD');
    const start = await this.startOtp(titular.id, this.resolvePreferredChannel(titular), 'RESET_PASSWORD', linkToken);
    return start;
  }

  async verifyOtp(loginRawOrToken: string, otp: string, purpose: OtpPurpose): Promise<VerifyResult> {
    const { titularId, channel } = await this.resolveTitularForOtp(loginRawOrToken, purpose);

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
      (await this.consumeTokenByRawOrNull('VERIFY_FIRST_ACCESS', verificationTokenOrLinkToken)) ??
      (await this.consumeTokenByRaw('FIRST_ACCESS_LINK', verificationTokenOrLinkToken));

    const senhaHash = await bcrypt.hash(password, 10);
    await this.ensureCredential(token.titularId);
    await (this.prisma as any).titularCredential.update({
      where: { titularId: token.titularId },
      data: { senhaHash },
    });
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
      (await this.consumeTokenByRawOrNull('VERIFY_RESET_PASSWORD', verificationTokenOrLinkToken)) ??
      (await this.consumeTokenByRaw('RESET_PASSWORD_LINK', verificationTokenOrLinkToken));

    const senhaHash = await bcrypt.hash(password, 10);
    await this.ensureCredential(token.titularId);
    await (this.prisma as any).titularCredential.update({
      where: { titularId: token.titularId },
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
    return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
  }

  private async findTitularByLogin(loginRaw: string) {
    const login = String(loginRaw ?? '').trim().toLowerCase();
    if (!login) return null;

    if (isEmail(login)) {
      return this.prisma.titular.findUnique({
        where: { email: login },
        select: { id: true, nome: true, email: true, cpf: true, telefone: true, metodoNotificacaoRecorrente: true },
      });
    }

    const cpf = normalizeCpf(login);
    if (cpf.length === 11) {
      return this.prisma.titular.findFirst({
        where: { cpf },
        select: { id: true, nome: true, email: true, cpf: true, telefone: true, metodoNotificacaoRecorrente: true },
      });
    }

    return null;
  }

  private resolvePreferredChannel(titular: { email?: string | null; telefone?: string | null; metodoNotificacaoRecorrente?: string | null }): NotificationChannel {
    const preferred = String(titular.metodoNotificacaoRecorrente ?? '').toLowerCase();
    const canWhatsapp = Boolean(titular.telefone && titular.telefone.trim().length >= 8);
    const canEmail = Boolean(titular.email && titular.email.includes('@'));
    if (preferred === 'whatsapp' && canWhatsapp) return 'whatsapp';
    if (preferred === 'email' && canEmail) return 'email';
    if (canEmail) return 'email';
    return canWhatsapp ? 'whatsapp' : config.notification.defaultMethod;
  }

  private async ensureCredential(titularId: number) {
    await (this.prisma as any).titularCredential.upsert({
      where: { titularId },
      update: {},
      create: { titularId },
    });
  }

  private async startOtp(
    titularId: number,
    channel: NotificationChannel,
    purpose: OtpPurpose,
    linkToken?: string,
  ): Promise<AuthStartResult> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: { email: true, telefone: true },
    });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await (this.prisma as any).titularOtp.create({
      data: {
        titularId,
        channel,
        purpose,
        codeHash,
        expiresAt,
      },
    });

    const destination =
      channel === 'email' ? String(titular?.email ?? '') : String(titular?.telefone ?? '');
    const destinationMasked = channel === 'email' ? maskEmail(destination) : maskPhone(destination);

    const messageParts = [
      `Seu código de verificação é: ${otp}`,
      `Ele expira em ${OTP_TTL_MINUTES} minutos.`,
    ];
    if (linkToken) {
      messageParts.push(`Link: ${this.buildPublicLink(purpose, linkToken)}`);
    }

    await this.notifier.send({
      to: destination,
      channel,
      subject: purpose === 'RESET_PASSWORD' ? 'Recuperação de senha' : 'Verificação de cadastro',
      message: messageParts.join('\n'),
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

  private async resolveTitularForOtp(loginOrToken: string, purpose: OtpPurpose): Promise<{ titularId: number; channel: NotificationChannel }> {
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
        select: { email: true, telefone: true, metodoNotificacaoRecorrente: true },
      });
      if (!titular) {
        const err: any = new Error('Cliente não encontrado.');
        err.status = 404;
        throw err;
      }
      return { titularId: token.titularId, channel: this.resolvePreferredChannel(titular) };
    }

    const titular = await this.findTitularByLogin(value);
    if (!titular) {
      const err: any = new Error('Cliente não encontrado.');
      err.status = 404;
      throw err;
    }
    return { titularId: titular.id, channel: this.resolvePreferredChannel(titular) };
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

  private async consumeTokenByRawOrNull(type: TokenType, raw: string): Promise<{ id: string; titularId: number } | null> {
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
    if (!record) return null;

    await (this.prisma as any).titularToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return record;
  }
}
