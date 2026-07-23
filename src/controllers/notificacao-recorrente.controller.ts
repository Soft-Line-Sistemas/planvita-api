import { Response } from 'express';
import {
  NotificacaoRecorrenteService,
  NotificationFlowType,
} from '../services/notificacao-recorrente.service';
import { TenantRequest } from '../middlewares/tenant.middleware';
import Logger from '../utils/logger';

export class NotificacaoRecorrenteController {
  private logger = new Logger({ service: 'NotificacaoRecorrenteController' });

  private respondFromError(res: Response, error: unknown, fallbackMessage: string) {
    const candidate = error as { status?: number; code?: string; message?: string };
    if (candidate?.status) {
      return res.status(candidate.status).json({ message: candidate.message ?? fallbackMessage });
    }
    if (candidate?.code === 'P2025') {
      return res.status(404).json({ message: 'Cliente não encontrado' });
    }
    return res.status(error instanceof Error && error.message === 'Tenant unknown' ? 400 : 500).json({
      message: error instanceof Error && error.message === 'Tenant unknown' ? 'Tenant unknown' : fallbackMessage,
    });
  }

  private resolveService(req: TenantRequest) {
    if (!req.tenantId) {
      throw new Error('Tenant unknown');
    }
    return new NotificacaoRecorrenteService(req.tenantId);
  }

  private resolveTipo(tipo?: any): NotificationFlowType | undefined {
    if (tipo === undefined || tipo === null) return undefined;
    const valor = Array.isArray(tipo) ? tipo[0] : tipo;
    const normalizado = valor ? String(valor).toLowerCase() : '';
    const permitidos: NotificationFlowType[] = [
      'lembrete-3-dias-antes',
      'cobranca-no-vencimento',
      'atraso-1-dia',
      'atraso-7-dias',
      'pendencia-periodica',
      'aviso-vencimento',
      'aviso-pendencia',
      'suspensao-preventiva',
      'suspensao',
      'pos-suspensao',
      'reajuste-anual',
      'renovacao-automatica',
    ];

    return permitidos.includes(normalizado as NotificationFlowType)
      ? (normalizado as NotificationFlowType)
      : undefined;
  }

  async getPainel(req: TenantRequest, res: Response) {
    try {
      const service = this.resolveService(req);
      const tipo = this.resolveTipo(req.query?.tipo) ?? 'lembrete-3-dias-antes';
      const result = await service.getPainel(tipo);
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
      const force = req.query.force
        ? String(req.query.force).toLowerCase() === 'true'
        : true; // padrão: disparo manual força execução imediata
      const tipo = this.resolveTipo(req.query?.tipo) ?? 'lembrete-3-dias-antes';
      const resultado = await service.dispararLote(force, tipo);
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

      if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ message: 'Payload inválido' });
      }

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
      this.respondFromError(res, error, 'Erro ao atualizar agendamento');
    }
  }

  async atualizarBloqueio(req: TenantRequest, res: Response) {
    const titularId = Number(req.params.titularId ?? req.params.id);
    if (Number.isNaN(titularId)) {
      return res.status(400).json({ message: 'ID do cliente inválido' });
    }

    try {
      const { bloqueado } = req.body ?? {};
      if (typeof bloqueado !== 'boolean') {
        return res.status(400).json({ message: 'Campo bloqueado é obrigatório' });
      }
      const service = this.resolveService(req);
      const tipo = this.resolveTipo(req.query?.tipo) ?? 'lembrete-3-dias-antes';
      const destinatario = await service.atualizarBloqueio(titularId, bloqueado, tipo);
      res.json(destinatario);
    } catch (error) {
      this.logger.error('Falha ao atualizar bloqueio de notificações', error, {
        tenant: req.tenantId,
        params: req.params,
      });
      this.respondFromError(res, error, 'Erro ao atualizar bloqueio do cliente');
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
      const tipo = this.resolveTipo(req.query?.tipo) ?? 'lembrete-3-dias-antes';
      const destinatario = await service.atualizarMetodo(
        titularId,
        metodo.toLowerCase() as any,
        tipo,
      );
      res.json(destinatario);
    } catch (error) {
      this.logger.error('Falha ao atualizar método de notificações', error, {
        tenant: req.tenantId,
        params: req.params,
      });
      this.respondFromError(res, error, 'Erro ao atualizar método do cliente');
    }
  }

  async getLogs(req: TenantRequest, res: Response) {
    try {
      const limit = Number(req.query.limit ?? 50);
      const service = this.resolveService(req);
      const logs = await service.getLogs(
        Number.isNaN(limit) ? 50 : Math.max(1, Math.min(limit, 200)),
        this.resolveTipo(req.query?.tipo),
      );
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
