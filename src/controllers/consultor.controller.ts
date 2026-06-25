import { Request, Response } from 'express';
import { ConsultorService } from '../services/consultor.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../types/auth';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

type TenantAuthRequest = TenantRequest & AuthRequest;

export class ConsultorController {
  private logger = new Logger({ service: 'ConsultorController' });

  private respondFromError(res: Response, error: unknown) {
    const candidate = error as { status?: number; code?: string; message?: string };
    if (candidate?.status) {
      return res.status(candidate.status).json({ message: candidate.message ?? 'Request failed' });
    }
    if (candidate?.code === 'P2025') {
      return res.status(404).json({ message: 'Consultor not found' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }

  async getPublicOptions(req: TenantRequest, res: Response) {
    try {
      const scope = String(req.query?.scope ?? '').trim().toLowerCase();
      if (scope === 'global') {
        const result = await ConsultorService.getGlobalPublicOptions();
        return res.json(result);
      }

      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new ConsultorService(req.tenantId);
      const result = await service.getPublicOptions();
      return res.json(result);
    } catch (error) {
      this.logger.error('Failed to get public consultor options', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new ConsultorService(req.tenantId);
      const result = await service.getAll();

      this.logger.info('getAll executed successfully', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all Consultor', error);
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

      const service = new ConsultorService(req.tenantId);
      const result = await service.getById(id);

      if (!result) {
        this.logger.warn(`Consultor not found for id: ${id}`, { tenant: req.tenantId });
        return res.status(404).json({ message: 'Consultor not found' });
      }

      this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get Consultor by id`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new ConsultorService(req.tenantId);
      const data = req.body;
      const result = await service.create(data);

      this.logger.info('create executed successfully', { tenant: req.tenantId, data });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create Consultor', error, { body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async update(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = new ConsultorService(req.tenantId);
      const data = req.body;
      const result = await service.update(id, data);

      this.logger.info(`update executed successfully for id: ${id}`, {
        tenant: req.tenantId,
        data,
      });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to update Consultor`, error, {
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

      const service = new ConsultorService(req.tenantId);
      await service.delete(id);

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error) {
      this.logger.error(`Failed to delete Consultor`, error, { params: req.params });
      this.respondFromError(res, error);
    }
  }

  async getResumoMe(req: TenantAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      if (!req.user?.id) return res.status(401).json({ message: 'Não autenticado' });

      const service = new ConsultorService(req.tenantId);
      const resumo = await service.getResumoByUserId(req.user.id);

      if (!resumo) {
        return res.status(404).json({ message: 'Consultor não encontrado para este usuário.' });
      }

      return res.json(resumo);
    } catch (error) {
      this.logger.error('Failed to get consultor resumo', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getComissoesMe(req: TenantAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      if (!req.user?.id) return res.status(401).json({ message: 'Não autenticado' });

      const service = new ConsultorService(req.tenantId);
      const resultado = await service.listarComissoesByUserId(req.user.id);

      if (!resultado) {
        return res.status(404).json({ message: 'Consultor não encontrado para este usuário.' });
      }

      return res.json(resultado);
    } catch (error) {
      this.logger.error('Failed to get consultor comissoes', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
}
