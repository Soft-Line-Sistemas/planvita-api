import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js';
import config from '../config';
import { getConfiguredPublicTenants } from '../utils/tenants';

type QrState = {
  qr: string | null;
  generatedAt: number | null;
};

type WaitQrResult = {
  qr: string | null;
  generatedAt: number | null;
  ready: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class TenantWhatsAppClientService {
  private client: Client | null = null;
  private initializing: Promise<void> | null = null;
  private lifecycleOp: Promise<void> | null = null;
  private ready = false;
  private authenticated = false;
  private connectionState: string | null = null;
  private qrState: QrState = { qr: null, generatedAt: null };

  constructor(private tenantId: string) {}

  private get sessionPath() {
    return (
      config.whatsapp.sessionPath ||
      path.resolve(process.cwd(), '.wwebjs_auth')
    );
  }

  private get clientId() {
    const normalizedTenant = this.tenantId.trim().toLowerCase();
    return `${config.whatsapp.clientIdPrefix}-${normalizedTenant}`;
  }

  private createClientIfNeeded() {
    if (this.client) return;

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: this.sessionPath,
        clientId: this.clientId,
      }),
      puppeteer: {
        headless: true,
        protocolTimeout: config.whatsapp.protocolTimeoutMs,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--no-zygote',
        ],
      },
    });

    this.client.on('qr', (qr: string) => {
      this.qrState = { qr, generatedAt: Date.now() };
      this.ready = false;
      this.authenticated = false;
    });

    this.client.on('authenticated', () => {
      this.authenticated = true;
      this.qrState = { qr: null, generatedAt: null };
    });

    this.client.on('ready', () => {
      this.ready = true;
      this.authenticated = true;
      this.connectionState = 'CONNECTED';
      this.qrState = { qr: null, generatedAt: null };
    });

    this.client.on('change_state', (state: string) => {
      this.connectionState = state;
      if (state === 'CONNECTED') {
        this.ready = true;
        this.authenticated = true;
        this.qrState = { qr: null, generatedAt: null };
      }
    });

    this.client.on('auth_failure', () => {
      this.ready = false;
      this.authenticated = false;
      this.connectionState = null;
    });

    this.client.on('disconnected', () => {
      this.ready = false;
      this.authenticated = false;
      this.connectionState = null;
      void this.handleUnexpectedDisconnect();
    });

    this.initializing = this.client
      .initialize()
      .catch(async (error) => {
        await this.destroyClient();
        throw error;
      })
      .finally(() => {
        this.initializing = null;
      });
  }

  private async runLifecycleOp(operation: () => Promise<void>) {
    if (this.lifecycleOp) {
      await this.lifecycleOp.catch(() => undefined);
    }

    const pending = operation().finally(() => {
      if (this.lifecycleOp === pending) {
        this.lifecycleOp = null;
      }
    });

    this.lifecycleOp = pending;
    return pending;
  }

  async start() {
    this.createClientIfNeeded();
    if (this.initializing) {
      await this.initializing;
    }
  }

  isReady() {
    return this.ready || this.connectionState === 'CONNECTED';
  }

  isAuthenticated() {
    return this.authenticated || this.isReady();
  }

  getConnectionState() {
    if (this.isReady()) return 'CONNECTED';
    if (this.qrState.qr) return 'AWAITING_QR_SCAN';
    if (this.isAuthenticated()) return 'AUTHENTICATED';
    return this.connectionState || 'DISCONNECTED';
  }

  async getQrStatus(waitMs = 2500): Promise<WaitQrResult> {
    await this.start();

    const startedAt = Date.now();
    while (Date.now() - startedAt < waitMs) {
      if (this.isReady()) {
        return { qr: null, generatedAt: null, ready: true };
      }
      if (this.qrState.qr) {
        return {
          qr: this.qrState.qr,
          generatedAt: this.qrState.generatedAt,
          ready: false,
        };
      }
      await sleep(150);
    }

    return {
      qr: this.qrState.qr,
      generatedAt: this.qrState.generatedAt,
      ready: this.isReady(),
    };
  }

  private normalizeRecipient(recipient: string): string {
    let clean = recipient.replace(/\D/g, '');
    const defaultCountryCode = config.whatsapp.defaultCountryCode.replace(/\D/g, '');

    if (!clean.startsWith(defaultCountryCode)) {
      clean = `${defaultCountryCode}${clean}`;
    }

    clean = clean.replace(new RegExp(`^${defaultCountryCode}0+`), defaultCountryCode);
    return clean;
  }

  private async ensureReady() {
    await this.start();
    if (this.isReady()) return;

    const becameReady = await this.waitUntilReady(
      config.whatsapp.readyTimeoutMs,
      300,
    );
    if (!becameReady) {
      throw new Error('WhatsApp client ainda não está pronto');
    }
  }

  private async waitUntilReady(timeoutMs = 20000, intervalMs = 300): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (this.isReady()) return true;
      await sleep(intervalMs);
    }
    return this.isReady();
  }

  private isRecoverableError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return (
      message.includes('Runtime.callFunctionOn timed out') ||
      message.includes('Protocol error') ||
      message.includes('Execution context was destroyed') ||
      message.includes('Target closed') ||
      message.includes('Session closed')
    );
  }

  private async handleUnexpectedDisconnect() {
    await this.runLifecycleOp(async () => {
      await this.destroyClient();
    }).catch(() => undefined);
  }

  private async destroyClient() {
    this.ready = false;
    this.authenticated = false;
    this.connectionState = null;

    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
      }
    }

    this.client = null;
    this.initializing = null;
  }

  private async restartClient() {
    await this.runLifecycleOp(async () => {
      await this.destroyClient();
      this.qrState = { qr: null, generatedAt: null };
      await this.start();
    });
  }

  private async sendMessageOnce(to: string, message: string, mediaPath?: string) {
    await this.ensureReady();

    const normalized = this.normalizeRecipient(to);
    const numberId = await this.client!.getNumberId(normalized);
    if (!numberId) {
      throw new Error(`Número não encontrado no WhatsApp: ${normalized}`);
    }

    const jid = numberId._serialized;
    const sent = mediaPath
      ? await this.client!.sendMessage(
          jid,
          MessageMedia.fromFilePath(mediaPath),
          message ? { caption: message } : undefined,
        )
      : await this.client!.sendMessage(jid, message);
    const sentUnsafe = sent as any;

    const referenceId =
      typeof sent?.id?._serialized === 'string' && sent.id._serialized.trim()
        ? sent.id._serialized
        : typeof sentUnsafe?._data?.id?.id === 'string' && sentUnsafe._data.id.id.trim()
          ? sentUnsafe._data.id.id
          : undefined;

    return {
      referenceId,
      jid,
      normalized,
    };
  }

  async sendMessage(to: string, message: string, mediaPath?: string) {
    const maxAttempts = config.whatsapp.sendRetries + 1;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.sendMessageOnce(to, message, mediaPath);
      } catch (error) {
        lastError = error;
        if (!this.isRecoverableError(error) || attempt >= maxAttempts) {
          throw error;
        }
        await this.restartClient();
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Falha ao enviar mensagem pelo WhatsApp');
  }

  async resetSession() {
    this.qrState = { qr: null, generatedAt: null };
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
      }
    }

    await this.destroyClient();

    const sessionDir = path.join(this.sessionPath, `session-${this.clientId}`);
    await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);

    await this.start();
  }
}

const whatsappClientRegistry = new Map<string, TenantWhatsAppClientService>();

export function getWhatsappClientForTenant(tenantId: string) {
  const normalizedTenant = tenantId.trim().toLowerCase();
  if (!whatsappClientRegistry.has(normalizedTenant)) {
    whatsappClientRegistry.set(
      normalizedTenant,
      new TenantWhatsAppClientService(normalizedTenant),
    );
  }
  return whatsappClientRegistry.get(normalizedTenant)!;
}

export async function resolveWhatsappClientForSending(preferredTenant?: string) {
  const normalizedPreferred = String(preferredTenant ?? '')
    .trim()
    .toLowerCase();
  const sharedSessionTenant = String(
    process.env.WHATSAPP_SHARED_SESSION_TENANT || 'lider',
  )
    .trim()
    .toLowerCase();
  const configuredTenants = getConfiguredPublicTenants();
  const knownTenants = Array.from(whatsappClientRegistry.keys());
  const tenants = Array.from(
    new Set(
      [sharedSessionTenant, normalizedPreferred, ...configuredTenants, ...knownTenants].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );

  for (const tenant of tenants) {
    const client = getWhatsappClientForTenant(tenant);
    if (client.isReady()) {
      return { tenant, client };
    }
  }

  for (const tenant of tenants) {
    const client = getWhatsappClientForTenant(tenant);
    try {
      const status = await client.getQrStatus(250);
      if (status.ready || client.isReady()) {
        return { tenant, client };
      }
    } catch {
      continue;
    }
  }

  if (normalizedPreferred) {
    return {
      tenant: normalizedPreferred,
      client: getWhatsappClientForTenant(normalizedPreferred),
    };
  }

  const fallbackTenant = configuredTenants[0] ?? knownTenants[0];
  if (!fallbackTenant) {
    throw new Error('Nenhum tenant de WhatsApp configurado para envio.');
  }

  return {
    tenant: fallbackTenant,
    client: getWhatsappClientForTenant(fallbackTenant),
  };
}
