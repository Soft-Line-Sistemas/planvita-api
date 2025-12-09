import { Response } from 'express';
import { TenantRequest } from '../middlewares/tenant.middleware';
import { NotificacaoTemplateService } from '../services/notificacao-template.service';
import Logger from '../utils/logger';
import { uploadToFilesApi } from '../utils/filesClient';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'application/pdf': '.pdf',
};
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

function sanitizeFilename(name: string, mimeType: string) {
  const safeBase = name.replace(/[/\\\\]+/g, '').replace(/[^\w.-]/g, '_').slice(0, 80) || 'file';
  const desiredExt = MIME_TO_EXT[mimeType] || '';
  const hasValidExt = safeBase.toLowerCase().endsWith(desiredExt);
  return hasValidExt ? safeBase : `${safeBase}${desiredExt}`;
}

function estimateBase64Size(base64: string) {
  const clean = base64.split(',').pop() || '';
  const padding = (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
  return (clean.length * 3) / 4 - padding;
}

export class NotificacaoTemplateController {
  private logger = new Logger({ service: 'NotificacaoTemplateController' });

  private resolveService(req: TenantRequest) {
    if (!req.tenantId) throw new Error('Tenant unknown');
    return new NotificacaoTemplateService(req.tenantId);
  }

  async listar(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const templates = await service.listar();
      res.json(templates);
    } catch (error) {
      this.logger.error('Erro ao listar templates', error, { tenant: req.tenantId });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message: 'Erro ao listar templates',
      });
    }
  }

  async criar(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const template = await service.criar(req.body);
      res.status(201).json(template);
    } catch (error) {
      this.logger.error('Erro ao criar template', error, { tenant: req.tenantId, body: req.body });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message: 'Erro ao criar template',
      });
    }
  }

  async atualizar(req: TenantRequest, res: Response) {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID inválido' });
    try {
      const service = this.resolveService(req);
      const template = await service.atualizar(id, req.body);
      res.json(template);
    } catch (error) {
      this.logger.error('Erro ao atualizar template', error, { tenant: req.tenantId, params: req.params });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message: 'Erro ao atualizar template',
      });
    }
  }

  async remover(req: TenantRequest, res: Response) {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID inválido' });
    try {
      const service = this.resolveService(req);
      await service.remover(id);
      res.status(204).send();
    } catch (error) {
      this.logger.error('Erro ao remover template', error, { tenant: req.tenantId, params: req.params });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message: 'Erro ao remover template',
      });
    }
  }

  async upload(req: TenantRequest, res: Response) {
    const { fileBase64, filename, mimeType } = req.body ?? {};
    if (!fileBase64 || !filename || !mimeType) {
      return res
        .status(400)
        .json({ message: 'Campos fileBase64, filename e mimeType são obrigatórios' });
    }
    if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

    const size = estimateBase64Size(fileBase64);
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return res.status(400).json({ message: 'Tipo de arquivo não permitido' });
    }
    if (size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ message: 'Arquivo excede o limite de 10MB' });
    }
    const safeName = sanitizeFilename(filename, mimeType);

    try {
      const result = await uploadToFilesApi(req.tenantId, fileBase64, safeName, mimeType);
      res.json(result);
    } catch (error) {
      this.logger.error('Erro ao enviar arquivo para files-api', error, { tenant: req.tenantId });
      res.status(500).json({ message: 'Erro ao enviar arquivo' });
    }
  }
}
