import { Response } from 'express';
import { NotificacaoRecorrenteService } from '../services/notificacao-recorrente.service';
import { TenantRequest } from '../middlewares/tenant.middleware';
import Logger from '../utils/logger';

export class NotificacaoRecorrenteController {
  private logger = new Logger({ service: 'NotificacaoRecorrenteController' });

  private resolveService(req: TenantRequest) {
    if (!req.tenantId) {
      throw new Error('Tenant unknown');
    }
    return new NotificacaoRecorrenteService(req.tenantId);
  }

  async getPainel(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const result = await service.getPainel();
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao buscar painel de notificações', error, {
        tenant: req.tenantId,
      });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message:
          error instanceof Error && error.message === 'Tenant unknown'
            ? 'Tenant unknown'
            : 'Erro ao carregar painel de notificações',
      });
    }
  }

  async disparar(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const force =
        String(req.query.force ?? req.body?.force ?? 'false').toLowerCase() === 'true';
      const resultado = await service.dispararLote(force);
      res.json(resultado);
    } catch (error) {
      this.logger.error('Falha ao disparar notificações recorrentes', error, {
        tenant: req.tenantId,
      });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message:
          error instanceof Error && error.message === 'Tenant unknown'
            ? 'Tenant unknown'
            : 'Erro ao disparar notificações',
      });
    }
  }

  async atualizarAgendamento(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const { frequenciaMinutos, proximaExecucao, metodoPreferencial, ativo } = req.body ?? {};

      const result = await service.atualizarAgendamento({
        frequenciaMinutos: frequenciaMinutos ? Number(frequenciaMinutos) : undefined,
        proximaExecucao: proximaExecucao ? new Date(proximaExecucao) : undefined,
        metodoPreferencial,
        ativo: typeof ativo === 'boolean' ? ativo : undefined,
      });

      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao atualizar agendamento de notificações', error, {
        tenant: req.tenantId,
        body: req.body,
      });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message:
          error instanceof Error && error.message === 'Tenant unknown'
            ? 'Tenant unknown'
            : 'Erro ao atualizar agendamento',
      });
    }
  }

  async atualizarBloqueio(req: TenantRequest, res: Response) {
    const titularId = Number(req.params.titularId ?? req.params.id);
    if (Number.isNaN(titularId)) {
      return res.status(400).json({ message: 'ID do cliente inválido' });
    }

    try {
      const { bloqueado } = req.body ?? {};
      const service = this.resolveService(req);
      const destinatario = await service.atualizarBloqueio(titularId, Boolean(bloqueado));
      res.json(destinatario);
    } catch (error) {
      this.logger.error('Falha ao atualizar bloqueio de notificações', error, {
        tenant: req.tenantId,
        params: req.params,
      });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message:
          error instanceof Error && error.message === 'Tenant unknown'
            ? 'Tenant unknown'
            : 'Erro ao atualizar bloqueio do cliente',
      });
    }
  }

  async atualizarMetodo(req: TenantRequest, res: Response) {
    const titularId = Number(req.params.titularId ?? req.params.id);
    if (Number.isNaN(titularId)) {
      return res.status(400).json({ message: 'ID do cliente inválido' });
    }

    const { metodo } = req.body ?? {};
    if (!metodo || !['whatsapp', 'email'].includes(String(metodo).toLowerCase())) {
      return res.status(400).json({ message: 'Método inválido (use whatsapp ou email)' });
    }

    try {
      const service = this.resolveService(req);
      const destinatario = await service.atualizarMetodo(titularId, metodo.toLowerCase() as any);
      res.json(destinatario);
    } catch (error) {
      this.logger.error('Falha ao atualizar método de notificações', error, {
        tenant: req.tenantId,
        params: req.params,
      });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message:
          error instanceof Error && error.message === 'Tenant unknown'
            ? 'Tenant unknown'
            : 'Erro ao atualizar método do cliente',
      });
    }
  }

  async getLogs(req: TenantRequest, res: Response) {
    try {
      const limit = Number(req.query.limit ?? 50);
      const service = this.resolveService(req);
      const logs = service.getLogs(Number.isNaN(limit) ? 50 : Math.max(1, Math.min(limit, 200)));
      res.json(logs);
    } catch (error) {
      this.logger.error('Falha ao obter logs de notificações', error, { tenant: req.tenantId });
      res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
        message:
          error instanceof Error && error.message === 'Tenant unknown'
            ? 'Tenant unknown'
            : 'Erro ao buscar logs',
      });
    }
  }
}
