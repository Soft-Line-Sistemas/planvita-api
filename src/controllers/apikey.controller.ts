import { Request, Response } from 'express';
import { ApiKeyService } from '../services/apikey.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class ApiKeyController {
  private logger = new Logger({ service: 'ApiKeyController' });

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const service = new ApiKeyService(req.tenantId);
      const result = await service.getAll();

      this.logger.info('getAll executed successfully', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all ApiKey', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const { id } = req.params;
      const service = new ApiKeyService(req.tenantId);
      const result = await service.getById(Number(id));

      if (!result) {
        this.logger.warn(`ApiKey not found for id: ${id}`);
        return res.status(404).json({ message: 'ApiKey not found' });
      }

      this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get ApiKey by id`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const service = new ApiKeyService(req.tenantId);
      const data = req.body;
      const result = await service.create(data);

      this.logger.info('create executed successfully', { data, tenant: req.tenantId });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create ApiKey', error, { body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async update(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const { id } = req.params;
      const service = new ApiKeyService(req.tenantId);
      const data = req.body;
      const result = await service.update(Number(id), data);

      this.logger.info(`update executed successfully for id: ${id}`, {
        data,
        tenant: req.tenantId,
      });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to update ApiKey`, error, { params: req.params, body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async delete(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const { id } = req.params;
      const service = new ApiKeyService(req.tenantId);
      await service.delete(Number(id));

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error) {
      this.logger.error(`Failed to delete ApiKey`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

