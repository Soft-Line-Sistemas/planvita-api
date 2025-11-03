import { Request, Response } from 'express';
import { TitularService } from '../services/titular.service';
import Logger from '../utils/logger';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class TitularController {
  private logger = new Logger({ service: 'TitularController' });

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId)
        return res.status(400).json({ message: "Tenant unknown" });

      const service = new TitularService(req.tenantId);

      const { page, limit, search, status, plano } = req.query;

      const result = await service.getAll({
        page: Number(page) || 1,
        limit: Number(limit) || 10,
        search: search?.toString(),
        status: status?.toString(),
        plano: plano?.toString(),
      });

      res.json(result);
    } catch (error) {
      this.logger.error("Failed to get all Titular", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }

  async getById(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new TitularService(req.tenantId);
      const { id } = req.params;
      const result = await service.getById(Number(id));

      if (!result) {
        this.logger.warn(`Titular not found for id: ${id}`, { tenant: req.tenantId });
        return res.status(404).json({ message: 'Titular not found' });
      }

      this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get Titular by id', error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new TitularService(req.tenantId);
      const data = req.body;
      const result = await service.create(data);

      this.logger.info('create executed successfully', { tenant: req.tenantId, data });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create Titular', error, { body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

   async createFull(req: any, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new TitularService(req.tenantId);
      const data = req.body;
      const result = await service.createFull(data);

      res.status(201).json(result);
    } catch (error: any) {
      if (error?.status === 409 || error?.code === 'EMAIL_IN_USE') {
        return res.status(409).json({
          message: 'E-mail já cadastrado para um titular.',
          ...(error.meta ? { meta: error.meta } : {}),
        });
      }
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ message: 'E-mail já cadastrado para um titular.' });
      }
      this.logger.error('Failed to createFull Titular', error, { body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async update(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new TitularService(req.tenantId);
      const { id } = req.params;
      const data = req.body;
      const result = await service.update(Number(id), data);

      this.logger.info(`update executed successfully for id: ${id}`, {
        tenant: req.tenantId,
        data,
      });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to update Titular', error, { params: req.params, body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async delete(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new TitularService(req.tenantId);
      const { id } = req.params;
      await service.delete(Number(id));

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error) {
      this.logger.error('Failed to delete Titular', error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}
