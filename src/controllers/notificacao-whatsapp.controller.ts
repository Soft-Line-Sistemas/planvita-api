import { Response } from 'express';
import { TenantRequest } from '../middlewares/tenant.middleware';
import Logger from '../utils/logger';
import { WhatsappNotificationService } from '../services/whatsapp-notification.service';
import {
  NotificacaoRecorrenteService,
  NotificationFlowType,
} from '../services/notificacao-recorrente.service';

export class NotificacaoWhatsappController {
  private logger = new Logger({ service: 'NotificacaoWhatsappController' });

  private resolveService(req: TenantRequest) {
    if (!req.tenantId) {
      throw new Error('Tenant unknown');
    }
    return new WhatsappNotificationService(req.tenantId);
  }

  private resolveRecurringService(req: TenantRequest) {
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
    ];

    return permitidos.includes(normalizado as NotificationFlowType)
      ? (normalizado as NotificationFlowType)
      : undefined;
  }

  async getOverview(req: TenantRequest, res: Response) {
    try {
      const result = await this.resolveService(req).getOverview();
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao carregar painel do WhatsApp', error, {
        tenant: req.tenantId,
      });
      res.status(500).json({ message: 'Erro ao carregar painel do WhatsApp' });
    }
  }

  async getQr(req: TenantRequest, res: Response) {
    try {
      const refresh = String(req.query.refresh ?? '0') === '1';
      const result = await this.resolveService(req).getQrStatus(refresh);
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao obter QR do WhatsApp', error, {
        tenant: req.tenantId,
      });
      res.status(503).json({ message: 'Não foi possível obter o QR do WhatsApp' });
    }
  }

  async disconnect(req: TenantRequest, res: Response) {
    try {
      const result = await this.resolveService(req).disconnect();
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao desconectar WhatsApp', error, {
        tenant: req.tenantId,
      });
      res.status(500).json({ message: 'Falha ao desconectar WhatsApp' });
    }
  }

  async updateConfig(req: TenantRequest, res: Response) {
    try {
      const result = await this.resolveService(req).updateConfig(req.body ?? {});
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao atualizar configuração do WhatsApp', error, {
        tenant: req.tenantId,
        body: req.body,
      });
      res.status(500).json({ message: 'Erro ao atualizar configuração do WhatsApp' });
    }
  }

  async getQueue(req: TenantRequest, res: Response) {
    try {
      const tipo = this.resolveTipo(req.query?.tipo) ?? 'lembrete-3-dias-antes';
      const result = await this.resolveRecurringService(req).getWhatsappQueue(tipo);
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao carregar fila do WhatsApp', error, {
        tenant: req.tenantId,
        query: req.query,
      });
      res.status(500).json({ message: 'Erro ao carregar fila do WhatsApp' });
    }
  }

  async sendTest(req: TenantRequest, res: Response) {
    try {
      const { to, message } = req.body ?? {};
      if (!to || !message) {
        return res
          .status(400)
          .json({ message: 'Campos to e message são obrigatórios' });
      }

      const result = await this.resolveService(req).sendManualTest(
        String(to),
        String(message),
      );
      res.json(result);
    } catch (error) {
      this.logger.error('Falha ao enviar teste do WhatsApp', error, {
        tenant: req.tenantId,
        body: req.body,
      });
      res.status(500).json({ message: 'Erro ao enviar teste do WhatsApp' });
    }
  }
}
