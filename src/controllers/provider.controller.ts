import { Response } from 'express';
import { TenantRequest } from '../middlewares/tenant.middleware';
import Logger from '../utils/logger';
import { AsaasIntegrationService } from '../services/asaas-integration.service';

export class ProviderController {
  private logger = new Logger({ service: 'ProviderController' });

  async getAsaasPayments(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const service = new AsaasIntegrationService(req.tenantId);
      const result = await service.listPaymentsFromProvider({
        status: (req.query.status as string | undefined) ?? undefined,
        customerId: (req.query.customerId as string | undefined) ?? undefined,
        externalReference:
          (req.query.externalReference as string | undefined) ?? undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      });

      this.logger.info('Pagamentos Asaas consultados via provider endpoint', {
        tenant: req.tenantId,
        status: req.query.status,
        customerId: req.query.customerId,
        externalReference: req.query.externalReference,
        count: result.data.length,
      });

      return res.json({
        success: true,
        data: result.data,
        metadata: {
          totalCount: result.totalCount ?? result.data.length,
          limit: result.limit ?? result.data.length,
          offset: result.offset ?? 0,
        },
      });
    } catch (error: any) {
      this.logger.error('Falha ao consultar pagamentos Asaas no provider endpoint', error, {
        tenant: req.tenantId,
        query: req.query,
      });
      return res.status(500).json({
        message: 'Não foi possível consultar o provedor Asaas.',
      });
    }
  }
}

