import { Response } from 'express';
import Logger from '../utils/logger';
import { ParceriasService } from '../services/parcerias.service';
import { TenantRequest } from '../middlewares/tenant.middleware';
import { ClienteAuthRequest } from '../middlewares/cliente-auth.middleware';

export class ParceriasController {
  private logger = new Logger({ service: 'ParceriasController' });

  private resolve(req: TenantRequest) {
    if (!req.tenantId) throw new Error('Tenant unknown');
    return new ParceriasService(req.tenantId);
  }

  async listarCategoriasAdmin(req: TenantRequest, res: Response) {
    try {
      const data = await this.resolve(req).listarCategorias();
      res.json(data);
    } catch (error) {
      this.logger.error('Erro ao listar categorias admin', error);
      res.status((error as Error).message === 'Tenant unknown' ? 400 : 500).json({ message: (error as Error).message });
    }
  }

  async salvarCategoria(req: TenantRequest, res: Response) {
    try {
      const data = await this.resolve(req).salvarCategoria(req.body);
      res.status(req.body?.id ? 200 : 201).json(data);
    } catch (error) {
      this.logger.error('Erro ao salvar categoria', error);
      res.status(400).json({ message: (error as Error).message });
    }
  }

  async listarParceirosAdmin(req: TenantRequest, res: Response) {
    try {
      const q = typeof req.query?.q === 'string' ? req.query.q : undefined;
      const data = await this.resolve(req).listarParceiros(q);
      res.json(data);
    } catch (error) {
      this.logger.error('Erro ao listar parceiros', error);
      res.status((error as Error).message === 'Tenant unknown' ? 400 : 500).json({ message: (error as Error).message });
    }
  }

  async salvarParceiro(req: TenantRequest, res: Response) {
    try {
      const data = await this.resolve(req).salvarParceiro(req.body);
      res.status(req.body?.id ? 200 : 201).json(data);
    } catch (error) {
      this.logger.error('Erro ao salvar parceiro', error);
      res.status(400).json({ message: (error as Error).message });
    }
  }

  async listarVantagensAdmin(req: TenantRequest, res: Response) {
    try {
      const data = await this.resolve(req).listarVantagensAdmin(req.query);
      res.json(data);
    } catch (error) {
      this.logger.error('Erro ao listar vantagens admin', error);
      res.status((error as Error).message === 'Tenant unknown' ? 400 : 500).json({ message: (error as Error).message });
    }
  }

  async salvarVantagem(req: TenantRequest, res: Response) {
    try {
      const data = await this.resolve(req).salvarVantagem(req.body);
      res.status(req.body?.id ? 200 : 201).json(data);
    } catch (error) {
      this.logger.error('Erro ao salvar vantagem', error);
      res.status(400).json({ message: (error as Error).message });
    }
  }

  async excluirVantagem(req: TenantRequest, res: Response) {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ message: 'ID inválido' });
      await this.resolve(req).excluirVantagem(id);
      res.status(204).send();
    } catch (error) {
      this.logger.error('Erro ao excluir vantagem', error);
      res.status(400).json({ message: (error as Error).message });
    }
  }

  async listarCategoriasCliente(req: TenantRequest, res: Response) {
    try {
      const data = await this.resolve(req).listarCategoriasCliente();
      res.json(data);
    } catch (error) {
      this.logger.error('Erro ao listar categorias cliente', error);
      res.status((error as Error).message === 'Tenant unknown' ? 400 : 500).json({ message: (error as Error).message });
    }
  }

  async listarVantagensCliente(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      const titularId = req.cliente?.titularId;
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });
      const q = typeof req.query?.q === 'string' ? req.query.q : undefined;
      const categoriaId = req.query?.categoriaId ? Number(req.query.categoriaId) : undefined;
      const destaque =
        req.query?.destaque === '1' || req.query?.destaque === 'true'
          ? true
          : req.query?.destaque === '0' || req.query?.destaque === 'false'
            ? false
            : undefined;
      const limit = req.query?.limit ? Number(req.query.limit) : undefined;
      const offset = req.query?.offset ? Number(req.query.offset) : undefined;
      const data = await this.resolve(req).listarVantagensCliente(titularId, {
        q,
        categoriaId,
        destaque,
        limit,
        offset,
      });
      res.json(data);
    } catch (error) {
      this.logger.error('Erro ao listar vantagens cliente', error);
      res.status((error as Error).message === 'Tenant unknown' ? 400 : 500).json({ message: (error as Error).message });
    }
  }

  async obterVantagemCliente(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      const titularId = req.cliente?.titularId;
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });
      const slug = String(req.params.slug ?? '').trim();
      if (!slug) return res.status(400).json({ message: 'Slug inválido' });
      const data = await this.resolve(req).obterVantagemCliente(titularId, slug);
      if (!data) return res.status(404).json({ message: 'Vantagem não encontrada' });
      res.json(data);
    } catch (error) {
      this.logger.error('Erro ao obter vantagem cliente', error);
      res.status((error as Error).message === 'Tenant unknown' ? 400 : 500).json({ message: (error as Error).message });
    }
  }

  async registrarResgate(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      const titularId = req.cliente?.titularId;
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });
      const vantagemId = Number(req.params.id);
      if (Number.isNaN(vantagemId)) return res.status(400).json({ message: 'ID inválido' });
      await this.resolve(req).registrarResgate(titularId, vantagemId, req.body?.canal);
      res.status(201).json({ ok: true });
    } catch (error) {
      this.logger.error('Erro ao registrar resgate', error);
      res.status((error as Error).message === 'Tenant unknown' ? 400 : 500).json({ message: (error as Error).message });
    }
  }

  async listarVantagensPublicas(req: TenantRequest, res: Response) {
    try {
      const limit = req.query?.limit ? Number(req.query.limit) : undefined;
      const data = await this.resolve(req).listarVantagensPublicas({ limit });
      res.json(data);
    } catch (error) {
      this.logger.error('Erro ao listar vantagens públicas', error);
      res.status((error as Error).message === 'Tenant unknown' ? 400 : 500).json({ message: (error as Error).message });
    }
  }
}
