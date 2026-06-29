import crypto from 'crypto';
import { getPrismaForTenant } from '../utils/prisma';
import { NotificationApiClient } from '../utils/notificationClient';
import Logger from '../utils/logger';
import { getConfiguredPublicTenants, getTenantLabel } from '../utils/tenants';

const TOKEN_TTL_MINUTES = 60;
const sha256Hex = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

export type TenantMatch = { tenantId: string; label: string };

export class AccountDeletionService {
  private logger = new Logger({ service: 'AccountDeletionService' });

  constructor() {}

  /**
   * Busca o e-mail em todos os bancos configurados.
   * Retorna a lista de tenants onde o titular está ativo.
   * Retorna array vazio se não encontrado em nenhum (silencia).
   */
  async findTenantsForEmail(email: string): Promise<TenantMatch[]> {
    const emailNorm = email.trim().toLowerCase();
    const tenants = getConfiguredPublicTenants();
    const found: TenantMatch[] = [];

    await Promise.all(
      tenants.map(async (tenantId) => {
        try {
          const prisma = getPrismaForTenant(tenantId);
          const titular = await prisma.titular.findFirst({
            where: { email: emailNorm },
            select: { id: true, statusPlano: true },
          });
          if (titular && titular.statusPlano !== 'INATIVO') {
            found.push({ tenantId, label: getTenantLabel(tenantId) });
          }
        } catch {
          // banco do tenant indisponível — ignora silenciosamente
        }
      }),
    );

    return found;
  }

  /**
   * Gera o token e envia o e-mail de confirmação para um tenant específico.
   */
  async requestDeletion(email: string, tenantId: string): Promise<void> {
    const emailNorm = email.trim().toLowerCase();
    const prisma = getPrismaForTenant(tenantId);
    const notifier = new NotificationApiClient(tenantId);

    const titular = await prisma.titular.findFirst({
      where: { email: emailNorm },
      select: { id: true, nome: true, email: true, statusPlano: true },
    });

    if (!titular || titular.statusPlano === 'INATIVO') return;

    // Invalida tokens anteriores do mesmo tipo para este titular
    await (prisma as any).titularToken.updateMany({
      where: {
        titularId: titular.id,
        type: 'ACCOUNT_DELETION_LINK',
        consumedAt: null,
      },
      data: { consumedAt: new Date() },
    });

    const raw = crypto.randomUUID();
    const tokenHash = sha256Hex(raw);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

    await (prisma as any).titularToken.create({
      data: {
        titularId: titular.id,
        type: 'ACCOUNT_DELETION_LINK',
        purpose: 'ACCOUNT_DELETION',
        tokenHash,
        expiresAt,
      },
    });

    const base = (process.env.FRONTEND_BASE_URL || '').replace(/\/$/, '') || 'https://planvita.com.br';
    const confirmUrl = new URL(`${base}/excluir-conta/confirmar`);
    confirmUrl.searchParams.set('token', raw);
    confirmUrl.searchParams.set('tenant', tenantId);

    const primeiroNome = titular.nome.split(' ')[0] ?? titular.nome;
    const html = buildDeletionEmail(primeiroNome, confirmUrl.toString(), TOKEN_TTL_MINUTES);

    await notifier.send({
      to: titular.email,
      channel: 'email',
      subject: 'Confirmação de exclusão de conta',
      message: `Olá, ${primeiroNome}. Recebemos uma solicitação para excluir sua conta. Acesse o link para confirmar: ${confirmUrl.toString()} — O link expira em ${TOKEN_TTL_MINUTES} minutos.`,
      html,
      metadata: { purpose: 'ACCOUNT_DELETION', tenant: tenantId },
    });

    this.logger.info('E-mail de confirmação de exclusão enviado', { titularId: titular.id, tenantId });
  }

  /**
   * Confirma a exclusão usando o token do e-mail.
   */
  async confirmDeletion(rawToken: string, tenantId: string): Promise<void> {
    const prisma = getPrismaForTenant(tenantId);
    const tokenHash = sha256Hex(rawToken);

    const record = await (prisma as any).titularToken.findFirst({
      where: {
        tokenHash,
        type: 'ACCOUNT_DELETION_LINK',
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, titularId: true },
    });

    if (!record) {
      const err: any = new Error('Link inválido ou expirado. Solicite um novo link de exclusão.');
      err.status = 400;
      throw err;
    }

    await (prisma as any).titularToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const titular = await prisma.titular.findUnique({
      where: { id: record.titularId },
      select: { id: true, statusPlano: true },
    });

    if (!titular) {
      const err: any = new Error('Conta não encontrada.');
      err.status = 404;
      throw err;
    }

    if (titular.statusPlano === 'INATIVO') return;

    const { TitularService } = await import('./titular.service');
    const titularService = new TitularService(tenantId);
    await titularService.inativarConta(record.titularId);

    this.logger.info('Conta inativada via link de confirmação', { titularId: record.titularId, tenantId });
  }
}

function buildDeletionEmail(nome: string, confirmUrl: string, ttlMinutes: number): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirmação de exclusão de conta</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#2d7a1f 0%,#3a9b28 60%,#1eba4b 100%);padding:28px 32px;">
              <p style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Campo do Bosque</p>
              <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,0.8);">Plataforma de Assistência Funeral</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#212121;">Olá, ${nome}</p>
              <p style="margin:0 0 24px;font-size:14px;color:#616161;line-height:1.6;">
                Recebemos uma solicitação para <strong>excluir sua conta</strong> na plataforma.
                Se foi você quem solicitou, clique no botão abaixo para confirmar.
              </p>

              <!-- Warning box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#fff8e1;border:1px solid #ffe082;border-radius:10px;padding:14px 16px;">
                    <p style="margin:0;font-size:13px;color:#7c5700;line-height:1.6;">
                      ⚠️ <strong>Atenção:</strong> esta ação é <strong>irreversível</strong>.
                      Seu acesso ao aplicativo será bloqueado e a cobrança do plano será cancelada.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="${confirmUrl}"
                       style="display:inline-block;background:#e53935;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:999px;box-shadow:0 4px 14px rgba(229,57,53,0.35);">
                      Confirmar exclusão da conta
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#9e9e9e;text-align:center;">
                O link expira em <strong>${ttlMinutes} minutos</strong>.
              </p>

              <hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0;" />

              <p style="margin:0;font-size:12px;color:#bdbdbd;line-height:1.6;">
                Se você <strong>não</strong> solicitou a exclusão da conta, ignore este e-mail —
                sua conta permanecerá ativa. Em caso de dúvidas, acesse o suporte no aplicativo.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #f0f0f0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#bdbdbd;">
                Campo do Bosque &copy; ${new Date().getFullYear()} — Plataforma de Assistência Funeral
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
