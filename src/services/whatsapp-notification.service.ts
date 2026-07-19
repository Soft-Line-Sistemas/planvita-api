import { NotificationPayload, NotificationSendResult, NotificationApiClient } from '../utils/notificationClient';
import { getPrismaForTenant } from '../utils/prisma';
import Logger from '../utils/logger';
import { getWhatsappClientForTenant, resolveWhatsappClientForSending } from './whatsapp-client.service';

export type WhatsappTriggerMode = 'AUTOMATIC' | 'MANUAL' | 'FALLBACK';

export interface WhatsappDispatchResult extends NotificationSendResult {
  provider?: 'OWN' | 'LEGACY_API';
  fallbackUsed?: boolean;
  referenceId?: string;
  triggerMode?: WhatsappTriggerMode;
}

const DEFAULT_RULES = [
  {
    key: 'LEMBRETE_3_DIAS_ANTES',
    title: 'Lembrete 3 dias antes',
    flow: 'lembrete-3-dias-antes',
    priority: 10,
    triggerType: 'PRE_DUE',
    offsetDays: -3,
  },
  {
    key: 'COBRANCA_NO_VENCIMENTO',
    title: 'Cobrança no vencimento',
    flow: 'cobranca-no-vencimento',
    priority: 20,
    triggerType: 'DUE',
    offsetDays: 0,
  },
  {
    key: 'ATRASO_1_DIA',
    title: 'Atraso 1 dia',
    flow: 'atraso-1-dia',
    priority: 30,
    triggerType: 'LATE',
    offsetDays: 1,
  },
  {
    key: 'ATRASO_7_DIAS',
    title: 'Atraso 7 dias',
    flow: 'atraso-7-dias',
    priority: 40,
    triggerType: 'LATE',
    offsetDays: 7,
  },
  {
    key: 'PENDENCIA_PERIODICA',
    title: 'Pendência periódica',
    flow: 'pendencia-periodica',
    priority: 50,
    triggerType: 'FLOW',
    offsetDays: 0,
  },
  {
    key: 'AVISO_VENCIMENTO',
    title: 'Aviso de vencimento',
    flow: 'aviso-vencimento',
    priority: 60,
    triggerType: 'FLOW',
    offsetDays: 0,
  },
  {
    key: 'AVISO_PENDENCIA',
    title: 'Aviso de pendência',
    flow: 'aviso-pendencia',
    priority: 70,
    triggerType: 'FLOW',
    offsetDays: 0,
  },
  {
    key: 'SUSPENSAO_PREVENTIVA',
    title: 'Suspensão preventiva',
    flow: 'suspensao-preventiva',
    priority: 80,
    triggerType: 'FLOW',
    offsetDays: 0,
  },
  {
    key: 'SUSPENSAO',
    title: 'Suspensão',
    flow: 'suspensao',
    priority: 90,
    triggerType: 'FLOW',
    offsetDays: 0,
  },
  {
    key: 'POS_SUSPENSAO',
    title: 'Pós-suspensão',
    flow: 'pos-suspensao',
    priority: 100,
    triggerType: 'FLOW',
    offsetDays: 0,
  },
] as const;

type WhatsappAutomationConfigModel = any;

export class WhatsappNotificationService {
  private prisma: any;
  private logger: Logger;
  private legacyClient: NotificationApiClient;

  constructor(private tenantId: string) {
    this.prisma = getPrismaForTenant(tenantId);
    this.logger = new Logger({ service: 'WhatsappNotificationService', tenantId });
    this.legacyClient = new NotificationApiClient(tenantId);
  }

  private get client() {
    return getWhatsappClientForTenant(this.tenantId);
  }

  private async resolveClientForSending() {
    return resolveWhatsappClientForSending(this.tenantId);
  }

  private mapRuleToCreate(configId: number, rule: (typeof DEFAULT_RULES)[number]) {
    return {
      configId,
      key: `${this.tenantId.toLowerCase()}_${rule.key}`,
      title: rule.title,
      flow: rule.flow,
      priority: rule.priority,
      triggerType: rule.triggerType,
      offsetDays: rule.offsetDays,
    };
  }

  private async ensureSeed(): Promise<WhatsappAutomationConfigModel> {
    const existing = await this.prisma.whatsappAutomationConfig.findFirst({
      where: { tenantId: this.tenantId },
      include: { rules: { orderBy: { priority: 'asc' } } },
    });

    if (existing) {
      const existingKeys = new Set(
        existing.rules.map((rule: any) => String(rule.key).toUpperCase()),
      );
      const missingRules = DEFAULT_RULES.filter(
        (rule) => !existingKeys.has(`${this.tenantId.toLowerCase()}_${rule.key}`.toUpperCase()),
      );

      if (missingRules.length) {
        await this.prisma.whatsappAutomationRule.createMany({
          data: missingRules.map((rule) => this.mapRuleToCreate(existing.id, rule)),
        });
      }

      return this.prisma.whatsappAutomationConfig.findUniqueOrThrow({
        where: { id: existing.id },
        include: { rules: { orderBy: { priority: 'asc' } } },
      });
    }

    return this.prisma.whatsappAutomationConfig.create({
      data: {
        tenantId: this.tenantId,
        enabled: true,
        useFallbackProvider: true,
        defaultCountryCode: '55',
        timezone: 'America/Bahia',
        sendOnWeekends: false,
        minIntervalMinutes: 240,
        rules: {
          create: DEFAULT_RULES.map((rule) => ({
            key: `${this.tenantId.toLowerCase()}_${rule.key}`,
            title: rule.title,
            flow: rule.flow,
            priority: rule.priority,
            triggerType: rule.triggerType,
            offsetDays: rule.offsetDays,
          })),
        },
      },
      include: { rules: { orderBy: { priority: 'asc' } } },
    });
  }

  async getOverview() {
    const config = await this.ensureSeed();
    const qrStatus = await this.client.getQrStatus(250);

    const [recent, sentToday, failedToday, fallbackToday] = await Promise.all([
      this.prisma.whatsappAutomationDispatch.findMany({
        where: { tenantId: this.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: { rule: true },
      }),
      this.prisma.whatsappAutomationDispatch.count({
        where: {
          tenantId: this.tenantId,
          sentAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          status: 'SENT',
        },
      }),
      this.prisma.whatsappAutomationDispatch.count({
        where: {
          tenantId: this.tenantId,
          attemptedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          status: 'FAILED',
        },
      }),
      this.prisma.whatsappAutomationDispatch.count({
        where: {
          tenantId: this.tenantId,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          triggerMode: 'FALLBACK',
        },
      }),
    ]);

    return {
      config,
      connection: {
        ready: this.client.isReady(),
        authenticated: this.client.isAuthenticated(),
        state: this.client.getConnectionState(),
        qrAvailable: Boolean(qrStatus.qr),
        qr: qrStatus.qr,
        generatedAt: qrStatus.generatedAt,
      },
      summary: {
        sentToday,
        failedToday,
        fallbackToday,
        activeRules: config.rules.filter((rule: any) => rule.enabled).length,
        minIntervalMinutes: config.minIntervalMinutes,
      },
      recent,
    };
  }

  private parseTimeToMinutes(value: string | null | undefined) {
    if (!value) return null;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  private getTimeZoneParts(now: Date, timezone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      weekday: byType.weekday,
      minutes: Number(byType.hour || 0) * 60 + Number(byType.minute || 0),
    };
  }

  private isInQuietHours(currentMinutes: number, start: number, end: number) {
    if (start === end) return true;
    if (start < end) return currentMinutes >= start && currentMinutes < end;
    return currentMinutes >= start || currentMinutes < end;
  }

  private async validateAutomaticWindow(config: any, recipient: string) {
    const timezone = config.timezone || 'America/Bahia';
    const local = this.getTimeZoneParts(new Date(), timezone);

    if (!config.sendOnWeekends && (local.weekday === 'Sat' || local.weekday === 'Sun')) {
      return { ok: false, reason: 'Envio automático bloqueado em finais de semana.' };
    }

    const quietStart = this.parseTimeToMinutes(config.quietHoursStart);
    const quietEnd = this.parseTimeToMinutes(config.quietHoursEnd);
    if (
      quietStart != null &&
      quietEnd != null &&
      this.isInQuietHours(local.minutes, quietStart, quietEnd)
    ) {
      return { ok: false, reason: 'Envio automático bloqueado pelo horário silencioso.' };
    }

    const minIntervalMinutes = Math.max(1, Number(config.minIntervalMinutes || 1));
    const latestSent = await this.prisma.whatsappAutomationDispatch.findFirst({
      where: {
        tenantId: this.tenantId,
        recipient,
        status: 'SENT',
        sentAt: { not: null },
      },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    });

    if (latestSent?.sentAt) {
      const diffMs = Date.now() - latestSent.sentAt.getTime();
      if (diffMs < minIntervalMinutes * 60 * 1000) {
        return { ok: false, reason: 'Envio automático bloqueado por intervalo mínimo.' };
      }
    }

    return { ok: true, reason: null };
  }

  private normalizeRecipient(recipient: string, defaultCountryCode?: string | null) {
    let clean = String(recipient || '').replace(/\D/g, '');
    const ddi = String(defaultCountryCode || '55').replace(/\D/g, '') || '55';

    if (!clean.startsWith(ddi)) {
      clean = `${ddi}${clean}`;
    }

    return clean.replace(new RegExp(`^${ddi}0+`), ddi);
  }

  async getQrStatus(refresh = false) {
    await this.ensureSeed();
    if (refresh) {
      await this.client.resetSession();
    }

    const status = await this.client.getQrStatus(refresh ? 12000 : 4000);
    const ready = status.ready || this.client.isReady();
    const qrAvailable = Boolean(status.qr);
    const authenticatedPending = !ready && !qrAvailable && this.client.isAuthenticated();

    return {
      ready,
      qrAvailable,
      qr: status.qr,
      generatedAt: status.generatedAt,
      state: this.client.getConnectionState(),
      message: ready
        ? 'Cliente já conectado ao WhatsApp'
        : qrAvailable
          ? 'QR gerado. Escaneie para conectar.'
          : authenticatedPending
            ? 'Sessão autenticada. Aguardando WhatsApp ficar pronto.'
            : 'Aguardando geração de um novo QR.',
    };
  }

  async disconnect() {
    await this.ensureSeed();
    await this.client.resetSession();
    return { success: true };
  }

  async updateConfig(input: {
    enabled?: boolean;
    useFallbackProvider?: boolean;
    defaultCountryCode?: string;
    timezone?: string;
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
    sendOnWeekends?: boolean;
    minIntervalMinutes?: number;
    rules?: Array<{ id: number; enabled?: boolean; title?: string }>;
  }) {
    const config = await this.ensureSeed();

    await this.prisma.$transaction(async (tx: any) => {
      await tx.whatsappAutomationConfig.update({
        where: { id: config.id },
        data: {
          enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
          useFallbackProvider:
            typeof input.useFallbackProvider === 'boolean'
              ? input.useFallbackProvider
              : undefined,
          defaultCountryCode: input.defaultCountryCode
            ? String(input.defaultCountryCode).replace(/\D/g, '') || '55'
            : undefined,
          timezone: input.timezone ? String(input.timezone) : undefined,
          quietHoursStart:
            input.quietHoursStart === undefined
              ? undefined
              : input.quietHoursStart
                ? String(input.quietHoursStart)
                : null,
          quietHoursEnd:
            input.quietHoursEnd === undefined
              ? undefined
              : input.quietHoursEnd
                ? String(input.quietHoursEnd)
                : null,
          sendOnWeekends:
            typeof input.sendOnWeekends === 'boolean'
              ? input.sendOnWeekends
              : undefined,
          minIntervalMinutes:
            input.minIntervalMinutes == null
              ? undefined
              : Math.max(1, Number(input.minIntervalMinutes)),
        },
      });

      for (const rule of input.rules ?? []) {
        await tx.whatsappAutomationRule.update({
          where: { id: rule.id },
          data: {
            enabled: typeof rule.enabled === 'boolean' ? rule.enabled : undefined,
            title: rule.title ? String(rule.title) : undefined,
          },
        });
      }
    });

    return this.ensureSeed();
  }

  private async createDispatchRecord(params: {
    configId?: number | null;
    ruleId?: number | null;
    titularId?: number | null;
    contaReceberId?: number | null;
    recipient?: string | null;
    flow?: string | null;
    status: string;
    triggerMode: WhatsappTriggerMode;
    provider: 'OWN' | 'LEGACY_API';
    fallbackUsed?: boolean;
    payloadPreview?: string | null;
    providerRef?: string | null;
    errorMessage?: string | null;
    attemptedAt?: Date | null;
    sentAt?: Date | null;
  }) {
    await this.prisma.whatsappAutomationDispatch.create({
      data: {
        tenantId: this.tenantId,
        configId: params.configId ?? undefined,
        ruleId: params.ruleId ?? undefined,
        titularId: params.titularId ?? undefined,
        contaReceberId: params.contaReceberId ?? undefined,
        recipient: params.recipient ?? undefined,
        flow: params.flow ?? undefined,
        status: params.status,
        attemptedAt: params.attemptedAt ?? undefined,
        sentAt: params.sentAt ?? undefined,
        errorMessage: params.errorMessage ?? undefined,
        payloadPreview: params.payloadPreview ?? undefined,
        providerRef: params.providerRef ?? undefined,
        provider: params.provider,
        triggerMode: params.triggerMode,
        fallbackUsed: Boolean(params.fallbackUsed),
      },
    });
  }

  async sendViaOwnConnectionOrFallback(input: {
    flow: string;
    recipient: string;
    message: string;
    triggerMode: Exclude<WhatsappTriggerMode, 'FALLBACK'>;
    titularId?: number;
    contaReceberId?: number;
    legacyPayload: NotificationPayload;
  }): Promise<WhatsappDispatchResult> {
    const config = await this.ensureSeed();
    const rule =
      config.rules.find((item: any) => item.flow === input.flow) ?? null;
    const now = new Date();
    const normalizedRecipient = this.normalizeRecipient(
      input.recipient,
      config.defaultCountryCode,
    );

    if (input.triggerMode === 'AUTOMATIC') {
      const windowCheck = await this.validateAutomaticWindow(
        config,
        normalizedRecipient,
      );
      if (!windowCheck.ok) {
        await this.createDispatchRecord({
          configId: config.id,
          ruleId: rule?.id,
          titularId: input.titularId,
          contaReceberId: input.contaReceberId,
          recipient: normalizedRecipient,
          flow: input.flow,
          status: 'SKIPPED',
          triggerMode: 'AUTOMATIC',
          provider: 'OWN',
          payloadPreview: input.message,
          errorMessage: windowCheck.reason,
          attemptedAt: now,
        });

        return {
          success: false,
          skipped: true,
          provider: 'OWN',
          error: windowCheck.reason || 'Envio automático bloqueado',
          triggerMode: input.triggerMode,
        };
      }
    }

    if (!config.enabled || (rule && !rule.enabled)) {
      return this.sendFallback({
        configId: config.id,
        ruleId: rule?.id,
        input: {
          ...input,
          recipient: normalizedRecipient,
          legacyPayload: {
            ...input.legacyPayload,
            to: normalizedRecipient,
            phone: normalizedRecipient,
          },
        },
        reason: !config.enabled
          ? 'Conexão própria desativada'
          : 'Fluxo desativado na automação do WhatsApp',
      });
    }

    try {
      const { tenant: sessionTenant, client } = await this.resolveClientForSending();
      const result = await client.sendMessage(normalizedRecipient, input.message);
      await this.createDispatchRecord({
        configId: config.id,
        ruleId: rule?.id,
        titularId: input.titularId,
        contaReceberId: input.contaReceberId,
        recipient: normalizedRecipient,
        flow: input.flow,
        status: 'SENT',
        triggerMode: input.triggerMode,
        provider: 'OWN',
        payloadPreview: input.message,
        providerRef: result.referenceId,
        errorMessage:
          sessionTenant && sessionTenant !== this.tenantId
            ? `Sessão compartilhada usada via tenant ${sessionTenant}`
            : undefined,
        attemptedAt: now,
        sentAt: new Date(),
      });

      return {
        success: true,
        provider: 'OWN',
        referenceId: result.referenceId,
        triggerMode: input.triggerMode,
      };
    } catch (error: any) {
      const message = error?.message ?? 'Falha ao enviar pela conexão própria';
      await this.createDispatchRecord({
        configId: config.id,
        ruleId: rule?.id,
        titularId: input.titularId,
        contaReceberId: input.contaReceberId,
        recipient: normalizedRecipient,
        flow: input.flow,
        status: 'FAILED',
        triggerMode: input.triggerMode,
        provider: 'OWN',
        payloadPreview: input.message,
        errorMessage: message,
        attemptedAt: now,
      });

      this.logger.warn('Falha no envio pelo WhatsApp próprio, tentando fallback', {
        flow: input.flow,
        recipient: input.recipient,
        error: message,
      });

      if (!config.useFallbackProvider) {
        return {
          success: false,
          provider: 'OWN',
          error: message,
          triggerMode: input.triggerMode,
        };
      }

      return this.sendFallback({
        configId: config.id,
        ruleId: rule?.id,
        input: {
          ...input,
          recipient: normalizedRecipient,
          legacyPayload: {
            ...input.legacyPayload,
            to: normalizedRecipient,
            phone: normalizedRecipient,
          },
        },
        reason: message,
      });
    }
  }

  private async sendFallback(params: {
    configId?: number | null;
    ruleId?: number | null;
    input: {
      flow: string;
      recipient: string;
      message: string;
      triggerMode: Exclude<WhatsappTriggerMode, 'FALLBACK'>;
      titularId?: number;
      contaReceberId?: number;
      legacyPayload: NotificationPayload;
    };
    reason: string;
  }): Promise<WhatsappDispatchResult> {
    const now = new Date();
    const result = await this.legacyClient.send(params.input.legacyPayload);

    await this.createDispatchRecord({
      configId: params.configId ?? undefined,
      ruleId: params.ruleId ?? undefined,
      titularId: params.input.titularId,
      contaReceberId: params.input.contaReceberId,
      recipient: params.input.recipient,
      flow: params.input.flow,
      status: result.success ? 'SENT' : result.skipped ? 'SKIPPED' : 'FAILED',
      triggerMode: 'FALLBACK',
      provider: 'LEGACY_API',
      fallbackUsed: true,
      payloadPreview: params.input.message,
      errorMessage: result.success ? params.reason : result.error ?? params.reason,
      attemptedAt: now,
      sentAt: result.success ? new Date() : undefined,
    });

    return {
      ...result,
      provider: 'LEGACY_API',
      fallbackUsed: true,
      triggerMode: 'FALLBACK',
    };
  }

  async sendManualTest(to: string, message: string) {
    const payload: NotificationPayload = {
      to,
      phone: to,
      channel: 'whatsapp',
      message,
      text: message,
      metadata: {
        tenantId: this.tenantId,
        source: 'manual-test',
      },
    };

    return this.sendViaOwnConnectionOrFallback({
      flow: 'manual-test',
      recipient: to,
      message,
      triggerMode: 'MANUAL',
      legacyPayload: payload,
    });
  }
}
