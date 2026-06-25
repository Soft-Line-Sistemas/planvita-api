import { Request, Response } from 'express';
import { PermissionService } from '../services/permission.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class PermissionController {
  private logger = new Logger({ service: 'PermissionController' });

  private respondFromError(res: Response, error: unknown) {
    const candidate = error as { status?: number; code?: string; message?: string };
    if (candidate?.status) {
      return res.status(candidate.status).json({ message: candidate.message ?? 'Request failed' });
    }
    if (candidate?.code === 'P2025') {
      return res.status(404).json({ message: 'Permission not found' });
    }
    if (candidate?.code === 'P2002') {
      return res.status(409).json({ message: 'Permission already exists' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new PermissionService(req.tenantId);
      const result = await service.getAll();

      this.logger.info('getAll executed successfully', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all Permission', error);
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

      const service = new PermissionService(req.tenantId);
      const result = await service.getById(id);

      if (!result) {
        this.logger.warn(`Permission not found for id: ${id}`, { tenant: req.tenantId });
        return res.status(404).json({ message: 'Permission not found' });
      }

      this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get Permission by id`, error, { params: req.params });
      this.respondFromError(res, error);
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new PermissionService(req.tenantId);
      const data = req.body;
      const result = await service.create(data);

      this.logger.info('create executed successfully', { tenant: req.tenantId, data });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create Permission', error, { body: req.body });
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

      const service = new PermissionService(req.tenantId);
      const data = req.body;
      const result = await service.update(id, data);

      this.logger.info(`update executed successfully for id: ${id}`, {
        tenant: req.tenantId,
        data,
      });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to update Permission`, error, {
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

      const service = new PermissionService(req.tenantId);
      await service.delete(id);

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error) {
      this.logger.error(`Failed to delete Permission`, error, { params: req.params });
      this.respondFromError(res, error);
    }
  }
}
