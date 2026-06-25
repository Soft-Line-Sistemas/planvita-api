import { Request, Response } from 'express';
import { TitularService } from '../services/titular.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { ClienteAuthRequest } from '../middlewares/cliente-auth.middleware';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

export class TitularController {
  private logger = new Logger({ service: 'TitularController' });

  private respondFromError(res: Response, error: any) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message ?? 'Request failed' });
    }
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'Titular not found' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }

  private getTitularIdFromClienteRequest(req: TenantRequest & ClienteAuthRequest): number | null {
    const titularId = Number(req?.cliente?.titularId);
    if (!titularId || Number.isNaN(titularId)) return null;
    return titularId;
  }

  private formatDate(value?: Date | string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  private escapeCsv(value: unknown): string {
    const text = value == null ? '' : String(value);
    const escaped = text.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private buildCadastroCsv(data: any[]): string {
    const headers = [
      'id',
      'nome',
      'cpf',
      'email',
      'telefone',
      'statusPlano',
      'dataNascimento',
      'dataContratacao',
      'planoId',
      'planoNome',
      'vendedorId',
      'vendedorNome',
      'cep',
      'uf',
      'cidade',
      'bairro',
      'logradouro',
      'numero',
      'complemento',
      'corresponsavelPrincipalNome',
      'corresponsavelPrincipalEmail',
      'corresponsavelPrincipalTelefone',
      'corresponsavelPrincipalRelacionamento',
      'dependentesQuantidade',
      'dependentes',
    ];

    const rows = data.map((titular) => {
      const corresponsavel = Array.isArray(titular.corresponsaveis)
        ? titular.corresponsaveis[0]
        : null;
      const dependentes = Array.isArray(titular.dependentes)
        ? titular.dependentes
            .map(
              (dep: any) =>
                `${dep.nome ?? ''}|${dep.cpf ?? ''}|${this.formatDate(dep.dataNascimento)}|${dep.tipoDependente ?? ''}`,
            )
            .join('; ')
        : '';

      return [
        titular.id,
        titular.nome,
        titular.cpf,
        titular.email,
        titular.telefone,
        titular.statusPlano,
        this.formatDate(titular.dataNascimento),
        this.formatDate(titular.dataContratacao),
        titular.plano?.id,
        titular.plano?.nome,
        titular.vendedor?.id,
        titular.vendedor?.nome,
        titular.cep,
        titular.uf,
        titular.cidade,
        titular.bairro,
        titular.logradouro,
        titular.numero,
        titular.complemento,
        corresponsavel?.nome,
        corresponsavel?.email,
        corresponsavel?.telefone,
        corresponsavel?.relacionamento,
        Array.isArray(titular.dependentes) ? titular.dependentes.length : 0,
        dependentes,
      ]
        .map((value) => this.escapeCsv(value))
        .join(',');
    });

    return [headers.map((value) => this.escapeCsv(value)).join(','), ...rows].join('\n');
  }

  async publicSearch(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId)
        return res.status(400).json({ message: "Tenant unknown" });

      const { cpf } = req.query;

      if (!cpf || typeof cpf !== 'string') {
        return res.status(400).json({ message: "CPF is required" });
      }

      const cpfNormalizado = cpf.replace(/\D/g, '');
      if (
        cpfNormalizado.length < 8 ||
        cpfNormalizado.length > 11 ||
        /^0+$/.test(cpfNormalizado)
      ) {
        return res.status(404).json({ message: "Titular not found" });
      }

      const service = new TitularService(req.tenantId);
      const titular = await service.getByCpfExact(cpfNormalizado);
      if (!titular) {
        return res.status(404).json({ message: "Titular not found" });
      }
      
      // Retorna detalhes completos do titular encontrado
      const detalhe = await service.getById(titular.id);
      if (!detalhe) {
         return res.status(404).json({ message: "Titular details not found" });
      }

      res.json({
        ...detalhe,
        tenantSlug: req.tenantId,
      });
    } catch (error: any) {
      this.logger.error("Failed to public search Titular", error);
      res.status(500).json({ message: "Internal server error", error: error.message, stack: error.stack });
    }
  }

  async me(req: any, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      if (req?.user && !req?.cliente) {
        return res.status(403).json({ message: 'Acesso disponível apenas para cliente autenticado.' });
      }
      const titularId = Number(req?.cliente?.titularId);
      if (!titularId || Number.isNaN(titularId)) {
        return res.status(401).json({ message: 'Não autenticado' });
      }

      const service = new TitularService(req.tenantId);
      const detalhe = await service.getById(titularId);
      if (!detalhe) return res.status(404).json({ message: 'Titular not found' });
      const fotoPerfil = await service.buscarFotoPerfil(titularId);

      res.json({
        ...detalhe,
        fotoPerfil,
        tenantSlug: req.tenantId,
      });
    } catch (error: any) {
      this.logger.error('Failed to get Titular me', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

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

  async exportCadastro(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) {
        return res.status(400).json({ message: 'Tenant unknown' });
      }

      const service = new TitularService(req.tenantId);
      const { search, status, plano } = req.query;
      const clientes = await service.getAllForExport({
        search: search?.toString(),
        status: status?.toString(),
        plano: plano?.toString(),
      });

      const csv = this.buildCadastroCsv(clientes);
      const filename = `cadastro-clientes-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(`\uFEFF${csv}`);
    } catch (error) {
      this.logger.error('Failed to export Titular cadastro', error, { query: req.query });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getAssinaturas(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const titularId = Number(req.params.id);
      if (Number.isNaN(titularId)) {
        return res.status(400).json({ message: 'ID inválido' });
      }
      const service = new TitularService(req.tenantId);
      const assinaturas = await service.listarAssinaturas(titularId);
      res.json(assinaturas);
    } catch (error) {
      this.logger.error('Falha ao listar assinaturas', error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getAssinaturasMe(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const titularId = this.getTitularIdFromClienteRequest(req);
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });

      const service = new TitularService(req.tenantId);
      const assinaturas = await service.listarAssinaturas(titularId);
      res.json(assinaturas);
    } catch (error) {
      this.logger.error('Falha ao listar assinaturas do cliente', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async salvarAssinatura(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const titularId = Number(req.params.id);
      if (Number.isNaN(titularId)) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const { tipo, assinaturaBase64 } = req.body as {
        tipo?: string;
        assinaturaBase64?: string;
      };

      if (!tipo || !assinaturaBase64) {
        return res
          .status(400)
          .json({ message: 'Tipo de assinatura e imagem são obrigatórios.' });
      }

      const service = new TitularService(req.tenantId);
      const result = await service.salvarAssinaturaDigital(
        titularId,
        tipo as any,
        assinaturaBase64,
      );
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Falha ao salvar assinatura', error, { body: req.body, params: req.params });
      const status = (error as any)?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(status).json({ message });
    }
  }

  async salvarAssinaturaMe(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const titularId = this.getTitularIdFromClienteRequest(req);
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });

      const { tipo, assinaturaBase64 } = req.body as {
        tipo?: string;
        assinaturaBase64?: string;
      };

      if (!tipo || !assinaturaBase64) {
        return res
          .status(400)
          .json({ message: 'Tipo de assinatura e imagem são obrigatórios.' });
      }

      const service = new TitularService(req.tenantId);
      const result = await service.salvarAssinaturaDigital(
        titularId,
        tipo as any,
        assinaturaBase64,
      );
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Falha ao salvar assinatura do cliente', error, { body: req.body });
      const status = (error as any)?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(status).json({ message });
    }
  }

  async downloadAssinatura(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const titularId = Number(req.params.id);
      const assinaturaId = Number(req.params.assinaturaId);
      if (Number.isNaN(titularId) || Number.isNaN(assinaturaId)) {
        return res.status(400).json({ message: 'Parâmetros inválidos' });
      }

      const service = new TitularService(req.tenantId);
      const { buffer, mimetype, filename } = await service.baixarAssinaturaDigital(
        titularId,
        assinaturaId,
      );

      const mode = req.query.mode === 'inline' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', mimetype);
      res.setHeader(
        'Content-Disposition',
        `${mode}; filename="${encodeURIComponent(filename)}"`,
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
      res.send(buffer);
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Internal server error';
      this.logger.error('Falha ao baixar assinatura', error, { params: req.params });
      res.status(status).json({ message });
    }
  }

  async downloadAssinaturaMe(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const titularId = this.getTitularIdFromClienteRequest(req);
      const assinaturaId = Number(req.params.assinaturaId);
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });
      if (Number.isNaN(assinaturaId)) {
        return res.status(400).json({ message: 'Parâmetros inválidos' });
      }

      const service = new TitularService(req.tenantId);
      const { buffer, mimetype, filename } = await service.baixarAssinaturaDigital(
        titularId,
        assinaturaId,
      );

      const mode = req.query.mode === 'inline' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', mimetype);
      res.setHeader(
        'Content-Disposition',
        `${mode}; filename="${encodeURIComponent(filename)}"`,
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
      res.send(buffer);
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Internal server error';
      this.logger.error('Falha ao baixar assinatura do cliente', error, { params: req.params });
      res.status(status).json({ message });
    }
  }

  async downloadContratoMe(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const titularId = this.getTitularIdFromClienteRequest(req);
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });

      const format = req.query.format === 'docx' ? 'docx' : 'pdf';
      const service = new TitularService(req.tenantId);
      const { buffer, mimetype, filename } = await service.baixarContratoComAssinaturas(
        titularId,
        format,
      );

      const mode = req.query.mode === 'inline' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', mimetype);
      res.setHeader(
        'Content-Disposition',
        `${mode}; filename="${encodeURIComponent(filename)}"`,
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
      res.send(buffer);
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Internal server error';
      this.logger.error('Falha ao baixar contrato do cliente', error, { params: req.params });
      res.status(status).json({ message });
    }
  }

  async downloadContrato(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const titularId = Number(req.params.id);
      if (Number.isNaN(titularId)) {
        return res.status(400).json({ message: 'Parâmetros inválidos' });
      }

      const format = req.query.format === 'docx' ? 'docx' : 'pdf';
      const service = new TitularService(req.tenantId);
      const { buffer, mimetype, filename } = await service.baixarContratoComAssinaturas(
        titularId,
        format,
      );

      const mode = req.query.mode === 'inline' ? 'inline' : 'attachment';
      res.setHeader('Content-Type', mimetype);
      res.setHeader(
        'Content-Disposition',
        `${mode}; filename="${encodeURIComponent(filename)}"`,
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
      res.send(buffer);
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Internal server error';
      this.logger.error('Falha ao baixar contrato', error, { params: req.params });
      res.status(status).json({ message });
    }
  }

  async uploadFotoPerfilMe(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const titularId = this.getTitularIdFromClienteRequest(req);
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });

      const { imageBase64, filename, mimeType } = req.body as {
        imageBase64?: string;
        filename?: string;
        mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
      };

      if (!imageBase64) {
        return res.status(400).json({ message: 'Imagem em base64 é obrigatória.' });
      }

      const service = new TitularService(req.tenantId);
      const foto = await service.salvarFotoPerfil(titularId, {
        imageBase64,
        filename,
        mimeType,
      });
      res.status(201).json(foto);
    } catch (error) {
      this.logger.error('Falha ao salvar foto de perfil do cliente', error, { body: req.body });
      const status = (error as any)?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(status).json({ message });
    }
  }

  async deleteFotoPerfilMe(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const titularId = this.getTitularIdFromClienteRequest(req);
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });

      const service = new TitularService(req.tenantId);
      await service.removerFotoPerfil(titularId);
      res.status(204).send();
    } catch (error) {
      this.logger.error('Falha ao remover foto de perfil do cliente', error);
      const status = (error as any)?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(status).json({ message });
    }
  }

  async downloadFotoPerfilMe(req: TenantRequest & ClienteAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      const titularId = this.getTitularIdFromClienteRequest(req);
      if (!titularId) return res.status(401).json({ message: 'Não autenticado' });

      const service = new TitularService(req.tenantId);
      const { buffer, mimetype } = await service.baixarFotoPerfil(titularId);

      res.setHeader('Content-Type', mimetype);
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.send(buffer);
    } catch (error: any) {
      const status = error?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Internal server error';
      this.logger.error('Falha ao baixar foto de perfil do cliente', error);
      res.status(status).json({ message });
    }
  }

  async getById(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const { id } = req.params;
      const titularId = Number(id);
      if (!Number.isInteger(titularId) || titularId <= 0) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = new TitularService(req.tenantId);
      const result = await service.getById(titularId);

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
      this.respondFromError(res, error);
    }
  }

  async sincronizarStatusPlano(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const batchSizeRaw =
        req.body?.batchSize ?? req.query?.batchSize ?? req.query?.batch;
      const batchSize = batchSizeRaw ? Number(batchSizeRaw) : 500;

      const service = new TitularService(req.tenantId);
      const resultado = await service.sincronizarStatusPlanoLote(batchSize);
      res.json(resultado);
    } catch (error) {
      this.logger.error('Failed to sync statusPlano', error, {
        tenant: req.tenantId,
        body: req.body,
        query: req.query,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async createFull(req: any, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new TitularService(req.tenantId);
      const data = req.body;
      const forwarded = req.headers['x-forwarded-for'];
      const requestIp =
        (typeof forwarded === 'string' && forwarded.trim()) ||
        (Array.isArray(forwarded) && forwarded[0]?.trim()) ||
        req.socket?.remoteAddress ||
        null;
      const result = await service.createFull(data, { requestIp });

      res.status(201).json(result);
    } catch (error: any) {
      if (error?.code === 'EMAIL_IN_USE') {
        return res.status(409).json({
          message: 'E-mail já cadastrado para um titular.',
          ...(error.meta ? { meta: error.meta } : {}),
        });
      }
      if (error instanceof PrismaClientKnownRequestError && error.code === 'P2002') {
        return res.status(409).json({ message: 'E-mail já cadastrado para um titular.' });
      }
      if (error?.status) {
        return res.status(error.status).json({
          message: error.message ?? 'Erro ao criar titular.',
          ...(error.code ? { code: error.code } : {}),
          ...(error.meta ? { meta: error.meta } : {}),
        });
      }
      this.logger.error('Failed to createFull Titular', error, { body: req.body });
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

      const service = new TitularService(req.tenantId);
      const data = req.body;
      const result = await service.update(id, data);

      this.logger.info(`update executed successfully for id: ${id}`, {
        tenant: req.tenantId,
        data,
      });
      res.json(result);
    } catch (error: any) {
      this.logger.error('Failed to update Titular', error, { params: req.params, body: req.body });
      if (error?.status) return res.status(error.status).json({ message: error.message });
      if (error?.code === 'P2025') return res.status(404).json({ message: 'Titular not found' });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async promoverCorresponsavel(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new TitularService(req.tenantId);
      const titularId = Number(req.params.id);
      if (!Number.isInteger(titularId) || titularId <= 0) {
        return res.status(400).json({ message: 'ID inválido' });
      }
      const corresponsavelIdRaw = (req.body as any)?.corresponsavelId;
      if (corresponsavelIdRaw === undefined || corresponsavelIdRaw === null) {
        return res.status(400).json({ message: 'corresponsavelId é obrigatório' });
      }
      const corresponsavelId = Number(corresponsavelIdRaw);
      if (!Number.isInteger(corresponsavelId) || corresponsavelId <= 0) {
        return res.status(400).json({ message: 'corresponsavelId inválido' });
      }

      const result = await service.promoverCorresponsavelParaTitular(titularId, corresponsavelId);
      res.json(result);
    } catch (error: any) {
      if (error?.status) {
        return res.status(error.status).json({
          message: error.message ?? 'Erro ao promover corresponsável.',
          ...(error.code ? { code: error.code } : {}),
        });
      }
      this.logger.error('Failed to promote Corresponsavel to Titular', error, {
        params: req.params,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async delete(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = new TitularService(req.tenantId);
      await service.delete(id);

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error: any) {
      this.logger.error('Failed to delete Titular', error, { params: req.params });
      if (error?.status) return res.status(error.status).json({ message: error.message });
      if (error?.code === 'P2025') return res.status(404).json({ message: 'Titular not found' });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}
