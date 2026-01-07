import { Response } from 'express';
import {
  FinanceiroService,
  BancoFinanceiroInput,
  TipoContabilFinanceiroInput,
  FormaPagamentoFinanceiraInput,
  CentroResultadoFinanceiroInput,
  ContaPagarInput,
  ContaReceberInput,
} from '../services/financeiro.service';
import Logger from '../utils/logger';
import { TenantRequest } from '../middlewares/tenant.middleware';

const isValidTipo = (tipo: string): tipo is 'pagar' | 'receber' => {
  const normalized = tipo.toLowerCase();
  return normalized === 'pagar' || normalized === 'receber';
};

export class FinanceiroController {
  private logger = new Logger({ service: 'FinanceiroController' });

  private resolveService(req: TenantRequest) {
    if (!req.tenantId) {
      throw new Error('Tenant unknown');
    }
    return new FinanceiroService(req.tenantId);
  }

  async getContas(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const result = await service.listarContas();
      this.logger.info('Contas financeiras listadas', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao listar contas financeiras', error);
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message:
          error instanceof Error && error.message === 'Tenant unknown'
            ? 'Tenant unknown'
            : 'Internal server error',
      });
    }
  }

  async createContaPagar(req: TenantRequest, res: Response) {
    try {
      const payload = this.normalizeContaPayload<ContaPagarInput>(req.body);
      const usuarioId = (req as any)?.user?.id as number | undefined;

      if (!payload.descricao || !payload.valor || !payload.vencimento) {
        return res.status(400).json({ message: 'Descrição, valor e vencimento são obrigatórios' });
      }
      const service = this.resolveService(req);
      const result = await service.criarContaPagar(payload, usuarioId);
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Falha ao criar conta a pagar', error, { body: req.body });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async createContaReceber(req: TenantRequest, res: Response) {
    try {
      const payload = this.normalizeContaPayload<ContaReceberInput>(req.body);
      const usuarioId = (req as any)?.user?.id as number | undefined;

      if (!payload.descricao || !payload.valor || !payload.vencimento) {
        return res.status(400).json({ message: 'Descrição, valor e vencimento são obrigatórios' });
      }
      const service = this.resolveService(req);
      const result = await service.criarContaReceber(payload, usuarioId);
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Falha ao criar conta a receber', error, { body: req.body });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async updateConta(req: TenantRequest, res: Response) {
    try {
      const { tipo, id } = req.params;
      const usuarioId = (req as any)?.user?.id as number | undefined;
      
      if (!tipo || !isValidTipo(tipo)) {
        return res.status(400).json({ message: 'Tipo de conta inválido' });
      }

      const contaId = Number(id);
      if (Number.isNaN(contaId)) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const payload = this.normalizeContaPayload<any>(req.body);
      const service = this.resolveService(req);
      
      let result;
      if (tipo === 'pagar') {
        result = await service.atualizarContaPagar(contaId, payload, usuarioId);
      } else {
        result = await service.atualizarContaReceber(contaId, payload, usuarioId);
      }
      
      this.logger.info('Conta atualizada com sucesso', {
        tenant: req.tenantId,
        tipo,
        contaId,
        usuarioId,
      });
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao atualizar conta', error, { params: req.params, body: req.body });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : (error as Error).message,
      });
    }
  }

  async deleteConta(req: TenantRequest, res: Response) {
    try {
      const { tipo, id } = req.params;
      const usuarioId = (req as any)?.user?.id as number | undefined;
      
      if (!tipo || !isValidTipo(tipo)) {
        return res.status(400).json({ message: 'Tipo de conta inválido' });
      }

      const contaId = Number(id);
      if (Number.isNaN(contaId)) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = this.resolveService(req);
      
      if (tipo === 'pagar') {
        await service.deletarContaPagar(contaId, usuarioId);
      } else {
        await service.deletarContaReceber(contaId, usuarioId);
      }
      
      this.logger.info('Conta removida com sucesso', {
        tenant: req.tenantId,
        tipo,
        contaId,
        usuarioId,
      });
      res.status(204).send();
    } catch (error) {
      this.logger.error('Falha ao remover conta', error, { params: req.params });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : (error as Error).message,
      });
    }
  }

  async baixarConta(req: TenantRequest, res: Response) {
    try {
      const { tipo, id } = req.params;
      const usuarioId = (req as any)?.user?.id as number | undefined;

      if (!tipo || !isValidTipo(tipo)) {
        return res.status(400).json({ message: 'Tipo de conta inválido' });
      }

      const contaId = Number(id);
      if (Number.isNaN(contaId)) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = this.resolveService(req);
      const result = await service.baixarConta(tipo === 'pagar' ? 'Pagar' : 'Receber', contaId, usuarioId);
      this.logger.info('Conta baixada com sucesso', {
        tenant: req.tenantId,
        tipo,
        contaId,
        usuarioId,
      });
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao baixar conta', error, { params: req.params });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message:
          error instanceof Error && error.message === 'Tenant unknown'
            ? 'Tenant unknown'
            : 'Internal server error',
      });
    }
  }

  async estornarConta(req: TenantRequest, res: Response) {
    try {
      const { tipo, id } = req.params;
      const usuarioId = (req as any)?.user?.id as number | undefined;

      if (!tipo || !isValidTipo(tipo)) {
        return res.status(400).json({ message: 'Tipo de conta inválido' });
      }

      const contaId = Number(id);
      if (Number.isNaN(contaId)) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = this.resolveService(req);
      const result = await service.estornarConta(tipo === 'pagar' ? 'Pagar' : 'Receber', contaId, usuarioId);
      this.logger.info('Conta estornada com sucesso', {
        tenant: req.tenantId,
        tipo,
        contaId,
        usuarioId,
      });
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao estornar conta', error, { params: req.params });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message:
          error instanceof Error && error.message === 'Tenant unknown'
            ? 'Tenant unknown'
            : 'Internal server error',
      });
    }
  }

  async getCadastros(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const result = await service.listarCadastros();
      this.logger.info('Catálogos financeiros listados', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao listar catálogos financeiros', error);
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async reconsultarContaReceber(req: TenantRequest, res: Response) {
    try {
      const { id } = req.params;
      const contaId = Number(id);
      const usuarioId = (req as any)?.user?.id as number | undefined;

      if (Number.isNaN(contaId)) {
        return res.status(400).json({ message: 'ID inválido' });
      }

      const service = this.resolveService(req);
      const result = await service.reconsultarContaReceber(contaId, usuarioId);
      this.logger.info('Reconsulta de status Asaas concluída', {
        tenant: req.tenantId,
        contaId,
        usuarioId,
      });
      res.json(result);
    } catch (error: any) {
      const message =
        error instanceof Error && error.message ? error.message : 'Internal server error';
      this.logger.error('Falha ao reconsultar status Asaas', error, { params: req.params });
      res.status(/Asaas|vinculad[ao]|encontrada/.test(message) ? 400 : 500).json({ message });
    }
  }

  async createBanco(req: TenantRequest, res: Response) {
    try {
      const payload = req.body as BancoFinanceiroInput;
      if (!payload?.nome) {
        return res.status(400).json({ message: 'Nome do banco é obrigatório' });
      }

      const service = this.resolveService(req);
      const result = await service.criarBanco(payload);
      this.logger.info('Banco financeiro criado', { tenant: req.tenantId, bancoId: result.id });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Falha ao criar banco financeiro', error, { body: req.body });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async deleteBanco(req: TenantRequest, res: Response) {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    try {
      const service = this.resolveService(req);
      await service.removerBanco(id);
      this.logger.info('Banco financeiro removido', { tenant: req.tenantId, bancoId: id });
      res.status(204).send();
    } catch (error) {
      this.logger.error('Falha ao remover banco financeiro', error, { params: req.params });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async createTipoContabil(req: TenantRequest, res: Response) {
    try {
      const payload = req.body as TipoContabilFinanceiroInput;
      if (!payload?.descricao) {
        return res.status(400).json({ message: 'Descrição é obrigatória' });
      }

      const service = this.resolveService(req);
      const result = await service.criarTipoContabil(payload);
      this.logger.info('Tipo contábil criado', { tenant: req.tenantId, tipoId: result.id });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Falha ao criar tipo contábil', error, { body: req.body });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async deleteTipoContabil(req: TenantRequest, res: Response) {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    try {
      const service = this.resolveService(req);
      await service.removerTipoContabil(id);
      this.logger.info('Tipo contábil removido', { tenant: req.tenantId, tipoId: id });
      res.status(204).send();
    } catch (error) {
      this.logger.error('Falha ao remover tipo contábil', error, { params: req.params });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async createFormaPagamento(req: TenantRequest, res: Response) {
    try {
      const payload = req.body as FormaPagamentoFinanceiraInput;
      if (!payload?.nome) {
        return res.status(400).json({ message: 'Nome da forma de pagamento é obrigatório' });
      }

      const service = this.resolveService(req);
      const result = await service.criarFormaPagamento(payload);
      this.logger.info('Forma de pagamento criada', { tenant: req.tenantId, formaId: result.id });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Falha ao criar forma de pagamento', error, { body: req.body });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async deleteFormaPagamento(req: TenantRequest, res: Response) {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    try {
      const service = this.resolveService(req);
      await service.removerFormaPagamento(id);
      this.logger.info('Forma de pagamento removida', { tenant: req.tenantId, formaId: id });
      res.status(204).send();
    } catch (error) {
      this.logger.error('Falha ao remover forma de pagamento', error, { params: req.params });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async createCentroResultado(req: TenantRequest, res: Response) {
    try {
      const payload = req.body as CentroResultadoFinanceiroInput;
      if (!payload?.nome) {
        return res.status(400).json({ message: 'Nome do centro de resultado é obrigatório' });
      }

      const service = this.resolveService(req);
      const result = await service.criarCentroResultado(payload);
      this.logger.info('Centro de resultado criado', { tenant: req.tenantId, centroId: result.id });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Falha ao criar centro de resultado', error, { body: req.body });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async deleteCentroResultado(req: TenantRequest, res: Response) {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    try {
      const service = this.resolveService(req);
      await service.removerCentroResultado(id);
      this.logger.info('Centro de resultado removido', { tenant: req.tenantId, centroId: id });
      res.status(204).send();
    } catch (error) {
      this.logger.error('Falha ao remover centro de resultado', error, { params: req.params });
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async getRelatorioFinanceiro(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const result = await service.getRelatorioFinanceiro();
      this.logger.info('Relatório financeiro gerado', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao gerar relatório financeiro', error);
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  async getMetricasRecorrencia(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const result = await service.getMetricasRecorrencia();
      this.logger.info('Métricas de recorrência geradas', { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao gerar métricas de recorrência', error);
      res.status(this.shouldReturnTenantError(error) ? 400 : 500).json({
        message: this.shouldReturnTenantError(error) ? 'Tenant unknown' : 'Internal server error',
      });
    }
  }

  private normalizeContaPayload<T extends { vencimento: Date; valor: number; descricao: string }>(
    body: any,
  ): T {
    const payload = { ...body };
    if (payload.vencimento) {
      payload.vencimento = new Date(payload.vencimento);
    }
    if (payload.valor) {
      payload.valor = Number(payload.valor);
    }
    if (payload.integrarAsaas !== undefined) {
      payload.integrarAsaas = payload.integrarAsaas !== false && payload.integrarAsaas !== 'false';
    }
    if (payload.billingType) {
      payload.billingType = String(payload.billingType).toUpperCase();
    }
    return payload;
  }

  private shouldReturnTenantError(error: unknown): boolean {
    return error instanceof Error && error.message === 'Tenant unknown';
  }
}
