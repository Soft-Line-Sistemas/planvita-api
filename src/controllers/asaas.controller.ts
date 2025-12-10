import { Request, Response } from 'express';
import { AsaasIntegrationService } from '../services/asaas-integration.service';
import { AsaasClient, AsaasWebhookEvent, resolveTenantForWebhook } from '../utils/asaasClient';
import Logger from '../utils/logger';

export class AsaasController {
  private logger = new Logger({ service: 'AsaasController' });

  async handleWebhook(req: Request, res: Response) {
    const tenantHeader =
      (req.headers['x-tenant'] as string | undefined) ||
      (req.headers['x-asaas-tenant'] as string | undefined);
    const queryTenant = (req.query?.tenant as string | undefined) ?? null;
    const bodyTenant = (req.body as any)?.tenantId as string | undefined;
    const tenantId = resolveTenantForWebhook(tenantHeader, queryTenant || bodyTenant);

    if (!tenantId) {
      this.logger.warn('Webhook Asaas rejeitado: tenant ausente');
      return res.status(400).json({ message: 'Tenant não informado' });
    }

    let client: AsaasClient;
    try {
      client = new AsaasClient(tenantId, (req as any).requestId);
    } catch (error: any) {
      this.logger.error('Falha ao inicializar client Asaas', error, { tenantId });
      return res.status(400).json({ message: 'Tenant sem configuração Asaas' });
    }

    const rawBody = (req as any).rawBody || JSON.stringify(req.body || {});
    const signature =
      (req.headers['x-signature'] as string | undefined) ||
      (req.headers['asaas-signature'] as string | undefined) ||
      (req.headers['x-asaas-signature'] as string | undefined) ||
      (req.headers['x-hub-signature'] as string | undefined);

    if (!client.validateWebhookSignature(rawBody, signature)) {
      this.logger.warn('Assinatura Asaas inválida', {
        tenantId,
        signaturePresent: !!signature,
      });
      return res.status(401).json({ message: 'Assinatura inválida' });
    }

    const integration = new AsaasIntegrationService(tenantId, (req as any).requestId);

    try {
      const result = await integration.handleWebhook(req.body as AsaasWebhookEvent);
      this.logger.info('Webhook Asaas processado', {
        tenantId,
        paymentId: (req.body as any)?.payment?.id,
        subscriptionId: (req.body as any)?.subscription?.id,
        status: result.status,
      });
      return res.status(200).json({ ok: true });
    } catch (error: any) {
      this.logger.error('Erro ao processar webhook Asaas', error, {
        tenantId,
        event: (req.body as any)?.event,
      });
      return res.status(500).json({ message: 'Erro ao processar webhook' });
    }
  }
}
