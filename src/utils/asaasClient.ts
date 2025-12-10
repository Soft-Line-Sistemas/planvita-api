import crypto from 'crypto';
import { Logger } from './logger';
import { retry } from './helpers';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface AsaasCredentials {
  apiKey: string;
  webhookSecret?: string;
  baseUrl: string;
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
}

export interface AsaasCustomerPayload {
  name: string;
  email?: string;
  cpfCnpj?: string;
  phone?: string;
  mobilePhone?: string;
  postalCode?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  city?: string;
  state?: string;
  externalReference?: string;
}

export interface AsaasSubscriptionPayload {
  customer: string;
  billingType: 'BOLETO' | 'PIX' | 'CREDIT_CARD';
  value: number;
  nextDueDate: string;
  description?: string;
  cycle?: 'MONTHLY' | 'WEEKLY' | 'YEARLY';
  fine?: number;
  interest?: number;
  endDate?: string;
  externalReference?: string;
}

export interface AsaasPaymentPayload {
  customer: string;
  billingType: 'BOLETO' | 'PIX' | 'CREDIT_CARD';
  value: number;
  dueDate: string;
  description?: string;
  externalReference?: string;
  subscription?: string;
}

export interface AsaasPagedResponse<T> {
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}

export interface AsaasWebhookEvent {
  event: string;
  dateCreated: string;
  payment?: {
    id: string;
    status: string;
    dueDate?: string;
    value?: number;
    invoiceUrl?: string;
    bankSlipUrl?: string;
    pixQrCode?: string;
    pixExpirationDate?: string;
    subscription?: string;
    billingType?: string;
  };
  subscription?: {
    id: string;
    status: string;
    nextDueDate?: string;
    value?: number;
  };
  customer?: {
    id: string;
  };
  account?: string;
}

export function resolveAsaasCredentials(tenantId: string): AsaasCredentials {
  const normalized = tenantId.trim().toUpperCase();
  const enabledTenants = (process.env.ASAAS_ENABLED_TENANTS || '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  const enabled = enabledTenants.length === 0 || enabledTenants.includes(normalized);

  const apiKey =
    process.env[`ASAAS_API_KEY_${normalized}`] ||
    process.env.ASAAS_API_KEY ||
    process.env.ASAAS_TOKEN ||
    '';

  const webhookSecret =
    process.env[`ASAAS_WEBHOOK_SECRET_${normalized}`] || process.env.ASAAS_WEBHOOK_SECRET;

  const baseUrl =
    process.env[`ASAAS_BASE_URL_${normalized}`] ||
    process.env.ASAAS_BASE_URL ||
    'https://sandbox.asaas.com/api/v3';

  const timeoutMs = Number(process.env.ASAAS_TIMEOUT_MS || 8000);
  const maxRetries = Number(process.env.ASAAS_MAX_RETRIES || 3);

  if (!apiKey) {
    throw new Error(`Asaas API key not configured for tenant ${tenantId}`);
  }

  return {
    apiKey,
    webhookSecret,
    baseUrl: baseUrl.replace(/\/$/, ''),
    enabled,
    timeoutMs,
    maxRetries,
  };
}

export class AsaasClient {
  private credentials: AsaasCredentials;
  private logger: Logger;

  constructor(private tenantId: string, private requestId?: string) {
    this.credentials = resolveAsaasCredentials(tenantId);
    this.logger = new Logger({
      service: 'AsaasClient',
      tenantId,
      requestId,
    });
  }

  async createCustomer(payload: AsaasCustomerPayload) {
    return this.request<any>('POST', '/customers', payload, {
      context: { customerId: payload.externalReference },
    });
  }

  async createOrUpdateSubscription(
    payload: AsaasSubscriptionPayload,
    subscriptionId?: string,
  ) {
    const path = subscriptionId ? `/subscriptions/${subscriptionId}` : '/subscriptions';
    const method: HttpMethod = subscriptionId ? 'PUT' : 'POST';
    return this.request<any>(method, path, payload, {
      context: { subscriptionId },
    });
  }

  async createPayment(payload: AsaasPaymentPayload) {
    return this.request<any>('POST', '/payments', payload, {
      context: { subscriptionId: payload.subscription, externalReference: payload.externalReference },
    });
  }

  async getPayments(params: Record<string, string | number | boolean | undefined> = {}) {
    return this.request<AsaasPagedResponse<any>>('GET', '/payments', undefined, { params });
  }

  async getPaymentById(paymentId: string) {
    return this.request<any>('GET', `/payments/${paymentId}`);
  }

  async getSubscriptions(params: Record<string, string | number | boolean | undefined> = {}) {
    return this.request<AsaasPagedResponse<any>>('GET', '/subscriptions', undefined, { params });
  }

  validateWebhookSignature(rawBody: string | Buffer, signature?: string | null): boolean {
    if (!signature || !this.credentials.webhookSecret) return false;
    const computed = crypto
      .createHmac('sha256', this.credentials.webhookSecret)
      .update(rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      // fallback in case of malformed input
      return computed === signature;
    }
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      context?: Record<string, unknown>;
    },
  ): Promise<T> {
    const { params = {}, context = {} } = options || {};
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      searchParams.append(key, String(value));
    });

    const url = `${this.credentials.baseUrl}${path}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
    const maxAttempts = this.credentials.maxRetries;

    const execRequest = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.credentials.timeoutMs);

      try {
        this.logger.info('Calling Asaas API', {
          url,
          method,
          tenantId: this.tenantId,
          requestId: this.requestId,
          ...context,
        });

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            access_token: this.credentials.apiKey,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        const responseText = await response.text();
        let parsed: any = null;

        try {
          parsed = responseText ? JSON.parse(responseText) : null;
        } catch {
          parsed = responseText;
        }

        if (!response.ok) {
          const error = new Error(`Asaas responded with status ${response.status}`);
          (error as any).status = response.status;
          (error as any).body = parsed ?? responseText;
          throw error;
        }

        this.logger.info('Asaas API call succeeded', {
          url,
          method,
          tenantId: this.tenantId,
          requestId: this.requestId,
          ...context,
        });

        return parsed as T;
      } finally {
        clearTimeout(timeout);
      }
    };

    try {
      return await retry(execRequest, maxAttempts, 500);
    } catch (error: any) {
      this.logger.error('Asaas API call failed', error, {
        url,
        method,
        tenantId: this.tenantId,
        requestId: this.requestId,
        ...context,
      });
      throw error;
    }
  }
}

export function resolveTenantForWebhook(
  explicitTenant?: string | null,
  fallbackTenant?: string | null,
): string | null {
  if (explicitTenant && explicitTenant.trim()) return explicitTenant.trim();
  if (fallbackTenant && fallbackTenant.trim()) return fallbackTenant.trim();
  return null;
}
