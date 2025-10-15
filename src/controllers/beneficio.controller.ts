import { Request, Response } from 'express';
import { BeneficioService } from '../services/beneficio.service';
import Logger from '../utils/logger';
import { PrismaClient } from '../../generated/prisma/client';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class BeneficioController {
  private logger = new Logger({ service: 'BeneficioController' });

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const service = new BeneficioService(req.tenantId);
      const result = await service.getAll();

      this.logger.info('getAll executed successfully', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all Beneficio', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const service = new BeneficioService(req.tenantId);
      const { id } = req.params;
      const result = await service.getById(Number(id));

      if (!result) {
        this.logger.warn(`Beneficio not found for id: ${id}`, { tenant: req.tenantId });
        return res.status(404).json({ message: 'Beneficio not found' });
      }

      this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get Beneficio by id`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const service = new BeneficioService(req.tenantId);
      const data = req.body;
      const result = await service.create(data);

      this.logger.info('create executed successfully', { tenant: req.tenantId, data });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create Beneficio', error, { body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async update(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const service = new BeneficioService(req.tenantId);
      const { id } = req.params;
      const data = req.body;
      const result = await service.update(Number(id), data);

      this.logger.info(`update executed successfully for id: ${id}`, {
        tenant: req.tenantId,
        data,
      });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to update Beneficio`, error, {
        params: req.params,
        body: req.body,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async delete(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const service = new BeneficioService(req.tenantId);
      const { id } = req.params;
      await service.delete(Number(id));

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error) {
      this.logger.error(`Failed to delete Beneficio`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}
