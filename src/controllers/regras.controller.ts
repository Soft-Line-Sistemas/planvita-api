import { Request, Response } from 'express';
import { RegrasService } from '../services/regras.service';
import Logger from '../utils/logger';

export interface TenantRequest extends Request {
  tenantId?: string;
}

export class RegrasController {
  private logger = new Logger({ service: 'RegrasController' });

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ error: 'Tenant unknown' });

      const service = new RegrasService(req.tenantId);
      const rules = await service.getAll();

      this.logger.info('getAll executed successfully', { tenant: req.tenantId });
      res.json(rules);
    } catch (err) {
      this.logger.error('Failed to get all business rules', err, { tenant: req.tenantId });
      res.status(500).json({ error: 'Erro ao buscar regras de negócio' });
    }
  }

  async getByTenant(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ error: 'Tenant unknown' });

      const service = new RegrasService(req.tenantId);
      const rule = await service.getByTenant(req.tenantId);

      if (!rule) {
        this.logger.warn(`Regras não encontradas para tenant: ${req.tenantId}`);
        return res.status(404).json({ error: 'Regras não encontradas' });
      }

      this.logger.info(`getByTenant executed successfully for tenant: ${req.tenantId}`);
      res.json(rule);
    } catch (err) {
      this.logger.error('Failed to get business rules by tenant', err, { tenantId: req.tenantId });
      res.status(500).json({ error: 'Erro ao buscar regras de negócio' });
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ error: 'Tenant unknown' });

      const service = new RegrasService(req.tenantId);
      const data = req.body;
      const rule = await service.create(data);

      this.logger.info('create executed successfully', { tenant: req.tenantId, data });
      res.status(201).json(rule);
    } catch (err) {
      this.logger.error('Failed to create business rules', err, { tenant: req.tenantId, body: req.body });
      res.status(500).json({ error: 'Erro ao criar regras de negócio' });
    }
  }

  async update(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ error: 'Tenant unknown' });

      const service = new RegrasService(req.tenantId);
      const data = req.body;
      const rule = await service.update(req.tenantId, data);

      this.logger.info('update executed successfully', { tenant: req.tenantId, data });
      res.json(rule);
    } catch (err: any) {
      this.logger.error('Failed to update business rules', err, { tenant: req.tenantId, body: req.body });
      if (err.code === 'P2025') return res.status(404).json({ error: 'Regras não encontradas' });
      res.status(500).json({ error: 'Erro ao atualizar regras de negócio' });
    }
  }
}
