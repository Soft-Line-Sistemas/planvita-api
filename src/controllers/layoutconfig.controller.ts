import { Request, Response } from 'express';
import { LayoutConfigService } from '../services/layoutconfig.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class LayoutConfigController {
  private logger = new Logger({ service: 'LayoutConfigController' });

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new LayoutConfigService(req.tenantId);
      const result = await service.getAll();

      this.logger.info('getAll executed successfully', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all LayoutConfig', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new LayoutConfigService(req.tenantId);
      const { id } = req.params;
      const result = await service.getById(Number(id));

      if (!result) {
        this.logger.warn(`LayoutConfig not found for id: ${id}`, { tenant: req.tenantId });
        return res.status(404).json({ message: 'LayoutConfig not found' });
      }

      this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get LayoutConfig by id`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getLayoutCss(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).send('Tenant unknown');
      }

      const service = new LayoutConfigService(req.tenantId);
      const layout = await service.getAll();

      if (!layout || layout.length === 0) {
        return res.status(404).send('Layout not found');
      }

      const config = layout[0];

      // Helper simples e seguro para gerar rgba
      const darken = (hex: string, alpha: number) => {
        if (!/^#([0-9A-F]{3}){1,2}$/i.test(hex)) return 'rgba(0,0,0,0.1)';
        const num = parseInt(hex.replace('#', ''), 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r},${g},${b},${alpha})`;
      };

      // Gera o CSS com base em variáveis limitadas
      const css = `
  :root {
    /* Cores básicas */
    --background: ${config.corFundo || '#ffffff'};
    --foreground: ${config.corTexto || '#000000'};

    --primary: ${config.corPrimaria || '#2563eb'};
    --secondary: ${config.corSecundaria || '#6b7280'};
    --accent: ${config.corPrimaria || '#2563eb'};
    --border: ${config.corSecundaria || '#e5e7eb'};

    /* Elementos interativos */
    --button-primary: ${config.corBotaoPrimario || config.corPrimaria || '#2563eb'};
    --button-primary-hover: ${darken(config.corBotaoPrimario || config.corPrimaria || '#2563eb', 0.9)};
    --button-secondary: ${config.corBotaoSecundario || config.corSecundaria || '#6b7280'};
    --link-color: ${config.corLink || config.corPrimaria || '#2563eb'};

    /* Fontes */
    --font-primary: ${config.fontePrimaria || 'Inter, sans-serif'};
    --font-secondary: ${config.fonteSecundaria || 'Inter, sans-serif'};
    --font-size-title: ${config.tamanhoFonteTitulo || 18}px;
    --font-size-base: ${config.tamanhoFonteBase || 14}px;

    /* Extras opcionais */
    --radius: ${config.bordaRadius || 8}px;
    --shadow-default: ${config.sombraPadrao || '0 2px 4px rgba(0,0,0,0.1)'};
    ${config.backgroundUrl ? `--background-image: url("${config.backgroundUrl}");` : ''}
  }

  /* Modo escuro opcional */
  .dark {
    --background: ${darken(config.corFundo || '#000', 0.85)};
    --foreground: ${config.corTexto || '#fff'};
    --primary: ${darken(config.corPrimaria || '#2563eb', 0.8)};
    --secondary: ${darken(config.corSecundaria || '#6b7280', 0.8)};
  }
  `;

      // Cabeçalhos recomendados
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).send(css.trim());
    } catch (error) {
      console.error('Failed to get LayoutConfig CSS:', error);
      res.status(500).send('Internal server error');
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const service = new LayoutConfigService(req.tenantId);
      const data = req.body;

      const result = await service.create({ ...data, tenantId: req.tenantId });

      this.logger.info('create executed successfully', { tenant: req.tenantId, data });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create LayoutConfig', error, { body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async update(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new LayoutConfigService(req.tenantId);
      const { id } = req.params;
      const { id: _, ...dataWithoutId } = req.body;
      const result = await service.update(Number(id), dataWithoutId);

      this.logger.info(`update executed successfully for id: ${id}`, {
        tenant: req.tenantId,
        dataWithoutId,
      });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to update LayoutConfig`, error, {
        params: req.params,
        body: req.body,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async delete(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new LayoutConfigService(req.tenantId);
      const { id } = req.params;
      await service.delete(Number(id));

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error) {
      this.logger.error(`Failed to delete LayoutConfig`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

