import { Request, Response } from 'express';
import { AsaasIntegrationService } from '../services/asaas-integration.service';
import {
  AsaasClient,
  AsaasWebhookEvent,
  resolveAsaasWebhookAuthToken,
  resolveTenantForWebhook,
} from '../utils/asaasClient';
import { getPrismaForTenant } from '../utils/prisma';
import Logger from '../utils/logger';

export class AsaasController {
  private logger = new Logger({ service: 'AsaasController' });

  async handleWebhook(req: Request, res: Response) {
    const tenantHeader =
      (req.headers['x-tenant'] as string | undefined) ||
      (req.headers['x-asaas-tenant'] as string | undefined);
    const queryTenant = (req.query?.tenant as string | undefined) ?? null;
    const bodyTenant = (req.body as any)?.tenantId as string | undefined;
    // O host do endpoint pode pertencer a outro tenant (por exemplo, um
    // webhook centralizado em api.campodobosque.com.br). Nunca o use para
    // decidir onde gravar um pagamento: resolva pelo ID da cobrança,
    // assinatura ou cliente presente no evento.
    const explicitTenantId = resolveTenantForWebhook(
      tenantHeader,
      queryTenant || bodyTenant,
    );

    if (!req.body || typeof req.body !== 'object' || !Object.keys(req.body).length) {
      this.logger.warn('Webhook Asaas rejeitado: payload vazio', { tenantId: explicitTenantId });
      return res.status(400).json({ message: 'Payload inválido' });
    }

    const webhookEvent = req.body as AsaasWebhookEvent;
    const resolvedTenantId =
      explicitTenantId ??
      (await this.resolveTenantFromWebhookEvent(webhookEvent, (req as any).requestId));

    if (!resolvedTenantId) {
      this.logger.warn('Webhook Asaas rejeitado: tenant não resolvido pelo payload', {
        paymentId: webhookEvent.payment?.id,
        subscriptionId: webhookEvent.payment?.subscription ?? webhookEvent.subscription?.id,
        customerId: this.extractCustomerId(webhookEvent),
        host: req.headers.host,
        event: webhookEvent.event,
      });
      return res.status(200).json({
        ok: true,
        ignored: true,
        message: 'Webhook recebido sem tenant resolvido',
      });
    }

    let client: AsaasClient;
    try {
      client = new AsaasClient(resolvedTenantId, (req as any).requestId);
    } catch (error: any) {
      this.logger.error('Falha ao inicializar client Asaas', error, { tenantId: resolvedTenantId });
      return res.status(400).json({ message: 'Tenant sem configuração Asaas' });
    }

    const authTokenHeader = req.headers['asaas-access-token'] as string | undefined;
    const expectedAuthToken = resolveAsaasWebhookAuthToken(resolvedTenantId);

    if (expectedAuthToken && authTokenHeader !== expectedAuthToken) {
      this.logger.warn('Token de autenticação do webhook Asaas inválido', {
        tenantId: resolvedTenantId,
        authTokenPresent: !!authTokenHeader,
      });
      return res.status(401).json({ message: 'Token de autenticação inválido' });
    }

    const integration = new AsaasIntegrationService(resolvedTenantId, (req as any).requestId);

    try {
      const result = await integration.handleWebhook(webhookEvent);
      this.logger.info('Webhook Asaas processado', {
        tenantId: resolvedTenantId,
        paymentId: webhookEvent?.payment?.id,
        subscriptionId: webhookEvent?.subscription?.id,
        status: result.status,
      });
      return res.status(200).json({ ok: true });
    } catch (error: any) {
      this.logger.error('Erro ao processar webhook Asaas', error, {
        tenantId: resolvedTenantId,
        event: webhookEvent?.event,
      });
      return res.status(500).json({ message: 'Erro ao processar webhook' });
    }
  }

  private async resolveTenantFromWebhookEvent(
    event: AsaasWebhookEvent,
    requestId?: string,
  ): Promise<string | null> {
    const paymentId = event.payment?.id ?? null;
    const subscriptionId = event.payment?.subscription ?? event.subscription?.id ?? null;
    const customerId = this.extractCustomerId(event);
    const configuredTenants = Object.keys(process.env)
      .filter((key) => key.startsWith('DATABASE_URL_') && process.env[key])
      .map((key) => key.replace(/^DATABASE_URL_/, '').toLowerCase())
      .filter(Boolean);

    if (!configuredTenants.length) {
      this.logger.warn('Nenhum tenant configurado para resolver webhook Asaas', { requestId });
      return null;
    }

    const matches = new Set<string>();

    for (const tenantId of configuredTenants) {
      try {
        const prisma = getPrismaForTenant(tenantId);

        if (paymentId) {
          const conta = await prisma.contaReceber.findUnique({
            where: { asaasPaymentId: paymentId },
            select: { id: true },
          });
          if (conta) {
            matches.add(tenantId);
            continue;
          }

          const pagamento = await prisma.pagamento.findUnique({
            where: { asaasPaymentId: paymentId },
            select: { id: true },
          });
          if (pagamento) {
            matches.add(tenantId);
            continue;
          }
        }

        if (subscriptionId) {
          const [conta, pagamento] = await Promise.all([
            prisma.contaReceber.findFirst({
              where: { asaasSubscriptionId: subscriptionId },
              select: { id: true },
            }),
            prisma.pagamento.findFirst({
              where: { asaasSubscriptionId: subscriptionId },
              select: { id: true },
            }),
          ]);
          if (conta || pagamento) {
            matches.add(tenantId);
            continue;
          }
        }

        if (customerId) {
          const titular = await prisma.titular.findFirst({
            where: { asaasCustomerId: customerId },
            select: { id: true },
          });
          if (titular) {
            matches.add(tenantId);
          }
        }
      } catch (error: any) {
        this.logger.warn('Falha ao inspecionar tenant para webhook Asaas', {
          tenantId,
          requestId,
          error: error?.message,
        });
      }
    }

    if (matches.size > 1) {
      this.logger.error('Webhook Asaas ambíguo: evento encontrado em múltiplos tenants', {
        requestId,
        paymentId,
        subscriptionId,
        customerId,
        tenants: Array.from(matches),
      });
      return null;
    }

    return Array.from(matches)[0] ?? null;
  }

  private extractCustomerId(event: AsaasWebhookEvent): string | null {
    const paymentCustomer = event.payment?.customer;
    if (typeof paymentCustomer === 'string' && paymentCustomer.trim()) {
      return paymentCustomer.trim();
    }
    if (paymentCustomer && typeof paymentCustomer === 'object' && paymentCustomer.id?.trim()) {
      return paymentCustomer.id.trim();
    }
    return event.customer?.id?.trim() ?? null;
  }

  private resolveTenantFromHost(hostHeader?: string): string | null {
    const rawHost = String(hostHeader ?? '')
      .split(',')[0]
      ?.trim()
      .split(':')[0]
      ?.toLowerCase();

    if (!rawHost) return null;

    if (rawHost === 'api.campodobosque.com.br' || rawHost === 'app.campodobosque.com.br') {
      return 'bosque';
    }

    if (rawHost === 'api.planvita.com.br' || rawHost === 'app.planvita.com.br') {
      return null;
    }

    const parts = rawHost.split('.');
    const forbidden = new Set(['www', 'api', 'app']);
    const candidate = parts.find((part) => part && !forbidden.has(part));
    return candidate || null;
  }
}
