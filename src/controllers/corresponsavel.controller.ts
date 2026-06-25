import { Request, Response } from 'express';
import { CorresponsavelService } from '../services/corresponsavel.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class CorresponsavelController {
  private logger = new Logger({ service: 'CorresponsavelController' });

  private respondFromError(res: Response, error: unknown) {
    const candidate = error as { status?: number; code?: string; message?: string };
    if (candidate?.status) {
      return res.status(candidate.status).json({ message: candidate.message ?? 'Request failed' });
    }
    if (candidate?.code === 'P2025') {
      return res.status(404).json({ message: 'Corresponsavel not found' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new CorresponsavelService(req.tenantId);
      const result = await service.getAll();

      this.logger.info('getAll executed successfully', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all Corresponsavel', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = new CorresponsavelService(req.tenantId);
      const result = await service.getById(id);

      if (!result) {
        this.logger.warn(`Corresponsavel not found for id: ${id}`, { tenant: req.tenantId });
        return res.status(404).json({ message: 'Corresponsavel not found' });
      }

      this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get Corresponsavel by id`, error, { params: req.params });
      this.respondFromError(res, error);
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new CorresponsavelService(req.tenantId);
      const data = req.body;
      const result = await service.create(data);

      this.logger.info('create executed successfully', { tenant: req.tenantId, data });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create Corresponsavel', error, { body: req.body });
      this.respondFromError(res, error);
    }
  }

  async update(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = new CorresponsavelService(req.tenantId);
      const data = req.body;
      const result = await service.update(id, data);

      this.logger.info(`update executed successfully for id: ${id}`, {
        tenant: req.tenantId,
        data,
      });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to update Corresponsavel`, error, {
        params: req.params,
        body: req.body,
      });
      this.respondFromError(res, error);
    }
  }

  async delete(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = new CorresponsavelService(req.tenantId);
      await service.delete(id);

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error) {
      this.logger.error(`Failed to delete Corresponsavel`, error, { params: req.params });
      this.respondFromError(res, error);
    }
  }
}
