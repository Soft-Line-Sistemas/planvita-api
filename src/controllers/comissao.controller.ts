import { Request, Response } from 'express';
import { ComissaoService, CreateComissaoManualInput } from '../services/comissao.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class ComissaoController {
  private logger = new Logger({ service: 'ComissaoController' });

  private respondFromError(res: Response, error: unknown) {
    const candidate = error as { status?: number; code?: string; message?: string };
    if (candidate?.status) {
      return res.status(candidate.status).json({ message: candidate.message ?? 'Request failed' });
    }
    if (candidate?.code === 'P2025') {
      return res.status(404).json({ message: 'Comissao not found' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new ComissaoService(req.tenantId);
      const result = await service.getAll();

      this.logger.info('getAll executed successfully', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all Comissao', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new ComissaoService(req.tenantId);
      const { id } = req.params;
      const result = await service.getById(Number(id));

      if (!result) {
        this.logger.warn(`Comissao not found for id: ${id}`, { tenant: req.tenantId });
        return res.status(404).json({ message: 'Comissao not found' });
      }

      this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get Comissao by id`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new ComissaoService(req.tenantId);
      const data = req.body as CreateComissaoManualInput;
      const result = await service.createManual(data);

      this.logger.info('create executed successfully', { tenant: req.tenantId, data });
      res.status(201).json(result);
    } catch (error: any) {
      this.logger.error('Failed to create Comissao', error, { body: req.body });
      const message =
        error instanceof Error && error.message ? error.message : 'Internal server error';
      res.status(/inválido|não encontrado|já possui comissão/i.test(message) ? 400 : 500).json({
        message,
      });
    }
  }

  async update(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new ComissaoService(req.tenantId);
      const { id } = req.params;
      const data = req.body;
      const result = await service.update(Number(id), data);

      this.logger.info(`update executed successfully for id: ${id}`, {
        tenant: req.tenantId,
        data,
      });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to update Comissao`, error, { params: req.params, body: req.body });
      this.respondFromError(res, error);
    }
  }

  async delete(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new ComissaoService(req.tenantId);
      const { id } = req.params;
      await service.delete(Number(id));

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error) {
      this.logger.error(`Failed to delete Comissao`, error, { params: req.params });
      this.respondFromError(res, error);
    }
  }
}
