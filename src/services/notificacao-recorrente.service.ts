import config from '../config';
import Logger from '../utils/logger';
import { NotificationApiClient, NotificationChannel } from '../utils/notificationClient';
import { getPrismaForTenant, Prisma } from '../utils/prisma';
import { NotificacaoTemplateService } from './notificacao-template.service';

type ContaReceberComCliente = Prisma.ContaReceberGetPayload<{
  include: {
    cliente: {
      select: {
        id: true;
        nome: true;
        email: true;
        telefone: true;
        cpf: true;
        bloquearNotificacaoRecorrente: true;
        metodoNotificacaoRecorrente: true;
      };
    };
  };
}>;

type NotificationScheduleModel = Prisma.NotificationScheduleGetPayload<{}>;

export interface DestinatarioNotificacao {
  titularId: number;
  nome: string;
  email: string | null;
  telefone: string | null;
  bloqueado: boolean;
  metodo: NotificationChannel;
  totalPendente: number;
  proximoVencimento: string | null;
  quantidadeCobrancas: number;
  cobrancas: Array<{
    contaId: number;
    descricao: string;
    valor: number;
    vencimento: string;
    status: string;
    diasAtraso: number;
  }>;
}

export interface PainelNotificacao {
  agendamento: {
    id: number;
    proximaExecucao: Date;
    segundosRestantes: number;
    frequenciaMinutos: number;
    metodoPreferencial: NotificationChannel;
    ativo: boolean;
    ultimaExecucao?: Date | null;
  };
  totais: {
    elegiveis: number;
    bloqueados: number;
    semContato: number;
    pendencias: number;
  };
  destinatarios: DestinatarioNotificacao[];
}

export interface ResultadoDisparo {
  enviados: number;
  ignorados: number;
  falhas: number;
  proximaExecucao: Date;
  ultimaExecucao: Date;
  detalhes?: Array<{
    titularId: number;
    nome: string;
    status: 'enviado' | 'ignorado' | 'falha';
    motivo?: string;
    canal: NotificationChannel;
  }>;
  logId?: string;
}

export class NotificacaoRecorrenteService {
  private prisma;
  private logger: Logger;
  private apiClient: NotificationApiClient;
  private templateService: NotificacaoTemplateService;
  private static memoriaLogs: Array<{
    id: string;
    timestamp: Date;
    tenantId: string;
    resumo: Pick<ResultadoDisparo, 'enviados' | 'ignorados' | 'falhas'>;
    detalhes: ResultadoDisparo['detalhes'];
  }> = [];

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
    this.logger = new Logger({ service: 'NotificacaoRecorrenteService', tenantId });
    this.apiClient = new NotificationApiClient(tenantId);
    this.templateService = new NotificacaoTemplateService(tenantId);
  }

  async getPainel(): Promise<PainelNotificacao> {
    const agendamento = await this.ensureAgendamento();
    const contas = await this.buscarPendencias();
    const destinatarios = this.mapearDestinatarios(contas, agendamento.metodoPreferencial);

    const agora = new Date();
    const segundosRestantes = Math.max(
      0,
      Math.floor((new Date(agendamento.proximaExecucao).getTime() - agora.getTime()) / 1000),
    );

    const totais = {
      elegiveis: destinatarios.filter((d) => !d.bloqueado && this.temContato(d)).length,
      bloqueados: destinatarios.filter((d) => d.bloqueado).length,
      semContato: destinatarios.filter((d) => !this.temContato(d)).length,
      pendencias: contas.length,
    };

    return {
      agendamento: {
        id: agendamento.id,
        proximaExecucao: agendamento.proximaExecucao,
        segundosRestantes,
        frequenciaMinutos: agendamento.frequenciaMinutos,
        metodoPreferencial: this.normalizarCanal(agendamento.metodoPreferencial),
        ativo: agendamento.ativo,
        ultimaExecucao: agendamento.ultimaExecucao,
      },
      totais,
      destinatarios,
    };
  }

  async atualizarAgendamento(data: Partial<Pick<NotificationScheduleModel, 'frequenciaMinutos' | 'proximaExecucao' | 'metodoPreferencial' | 'ativo'>>): Promise<NotificationScheduleModel> {
    const agendamento = await this.ensureAgendamento();

    const payload: Partial<NotificationScheduleModel> = { ...data };
    if (data.metodoPreferencial) {
      payload.metodoPreferencial = this.normalizarCanal(data.metodoPreferencial);
    }

    if (!data.proximaExecucao) {
      payload.proximaExecucao = this.calcularProximaExecucao(
        data.frequenciaMinutos ?? agendamento.frequenciaMinutos,
      );
    }

    const atualizado = await this.prisma.notificationSchedule.update({
      where: { id: agendamento.id },
      data: payload,
    });

    this.logger.info('Agendamento de notificação atualizado', {
      tenantId: this.tenantId,
      agendamentoId: atualizado.id,
      payload,
    });

    return atualizado;
  }

  async atualizarBloqueio(titularId: number, bloqueado: boolean): Promise<DestinatarioNotificacao> {
    await this.prisma.titular.update({
      where: { id: titularId },
      data: { bloquearNotificacaoRecorrente: bloqueado },
    });

    const agendamento = await this.ensureAgendamento();
    const contas = await this.buscarPendencias();
    const destinatarios = this.mapearDestinatarios(contas, agendamento.metodoPreferencial);

    const destinatario = destinatarios.find((d) => d.titularId === titularId);
    if (!destinatario) {
      throw new Error('Cliente não encontrado ou sem cobranças pendentes');
    }

    return destinatario;
  }

  async atualizarMetodo(titularId: number, metodo: NotificationChannel): Promise<DestinatarioNotificacao> {
    await this.prisma.titular.update({
      where: { id: titularId },
      data: { metodoNotificacaoRecorrente: this.normalizarCanal(metodo) },
    });

    const agendamento = await this.ensureAgendamento();
    const contas = await this.buscarPendencias();
    const destinatarios = this.mapearDestinatarios(contas, agendamento.metodoPreferencial);

    const destinatario = destinatarios.find((d) => d.titularId === titularId);
    if (!destinatario) {
      throw new Error('Cliente não encontrado ou sem cobranças pendentes');
    }

    return destinatario;
  }

  async dispararLote(force = true): Promise<ResultadoDisparo> {
    const agendamento = await this.ensureAgendamento();
    const agora = new Date();

    // Só dispara se já passou do horário programado
    if (!force && agora < new Date(agendamento.proximaExecucao)) {
      const segundosRestantes = Math.max(
        0,
        Math.floor((new Date(agendamento.proximaExecucao).getTime() - agora.getTime()) / 1000),
      );
      return {
        enviados: 0,
        ignorados: 0,
        falhas: 0,
        proximaExecucao: agendamento.proximaExecucao,
        ultimaExecucao: agendamento.ultimaExecucao ?? agora,
        detalhes: [],
        logId: undefined,
      };
    }

    if (!agendamento.ativo) {
      this.logger.warn('Tentativa de disparo com agendamento inativo', { tenantId: this.tenantId });
      return {
        enviados: 0,
        ignorados: 0,
        falhas: 0,
        proximaExecucao: agendamento.proximaExecucao,
        ultimaExecucao: agendamento.ultimaExecucao ?? new Date(),
        detalhes: [],
        logId: undefined,
      };
    }

    const contas = await this.buscarPendencias();
    const destinatarios = this.mapearDestinatarios(contas, agendamento.metodoPreferencial);

    let enviados = 0;
    let ignorados = 0;
    let falhas = 0;
    const detalhes: ResultadoDisparo['detalhes'] = [];
    const templateEmail = await this.templateService.obterDefault('email');
    const logsParaPersistir: Array<{
      tenantId: string;
      logId: string;
      titularId?: number;
      destinatario?: string;
      canal: NotificationChannel;
      status: string;
      motivo?: string;
      payload?: string;
    }> = [];
    const logIdGerado = `${agendamento.id}_${Date.now()}`;

    for (const destinatario of destinatarios) {
      const contato =
        destinatario.metodo === 'email' ? destinatario.email : destinatario.telefone;

      if (destinatario.bloqueado) {
        ignorados += 1;
        detalhes.push({
          titularId: destinatario.titularId,
          nome: destinatario.nome,
          status: 'ignorado',
          motivo: 'cliente bloqueado para notificações',
          canal: destinatario.metodo,
        });
        logsParaPersistir.push({
          tenantId: this.tenantId,
          logId: logIdGerado,
          titularId: destinatario.titularId,
          destinatario: contato ?? destinatario.email ?? destinatario.telefone ?? undefined,
          canal: destinatario.metodo,
          status: 'ignorado',
          motivo: 'cliente bloqueado para notificações',
        });
        continue;
      }

      if (!contato) {
        ignorados += 1;
        detalhes.push({
          titularId: destinatario.titularId,
          nome: destinatario.nome,
          status: 'ignorado',
          motivo: 'cliente sem contato válido',
          canal: destinatario.metodo,
        });
        logsParaPersistir.push({
          tenantId: this.tenantId,
          logId: logIdGerado,
          titularId: destinatario.titularId,
          destinatario: destinatario.email ?? destinatario.telefone ?? undefined,
          canal: destinatario.metodo,
          status: 'ignorado',
          motivo: 'cliente sem contato válido',
        });
        continue;
      }

      const payload = this.montarMensagem(destinatario, contato, destinatario.metodo, templateEmail || undefined);
      const resultado = await this.apiClient.send(payload);

      if (resultado.success) {
        enviados += 1;
        detalhes.push({
          titularId: destinatario.titularId,
          nome: destinatario.nome,
          status: 'enviado',
          canal: destinatario.metodo,
        });
        logsParaPersistir.push({
          tenantId: this.tenantId,
          logId: logIdGerado,
          titularId: destinatario.titularId,
          destinatario: contato,
          canal: destinatario.metodo,
          status: 'enviado',
        });
      } else if (resultado.skipped) {
        ignorados += 1;
        detalhes.push({
          titularId: destinatario.titularId,
          nome: destinatario.nome,
          status: 'ignorado',
          motivo: resultado.error ?? 'disparo ignorado',
          canal: destinatario.metodo,
        });
        logsParaPersistir.push({
          tenantId: this.tenantId,
          logId: logIdGerado,
          titularId: destinatario.titularId,
          destinatario: contato,
          canal: destinatario.metodo,
          status: 'ignorado',
          motivo: resultado.error ?? 'disparo ignorado',
          payload: JSON.stringify(resultado),
        });
      } else {
        falhas += 1;
        detalhes.push({
          titularId: destinatario.titularId,
          nome: destinatario.nome,
          status: 'falha',
          motivo: resultado.error ?? 'erro ao enviar',
          canal: destinatario.metodo,
        });
        logsParaPersistir.push({
          tenantId: this.tenantId,
          logId: logIdGerado,
          titularId: destinatario.titularId,
          destinatario: contato,
          canal: destinatario.metodo,
          status: 'falha',
          motivo: resultado.error ?? 'erro ao enviar',
          payload: JSON.stringify(resultado),
        });
      }
    }

    const ultimaExecucao = new Date();
    const proximaExecucao = this.calcularProximaExecucao(agendamento.frequenciaMinutos, ultimaExecucao);

    await this.prisma.notificationSchedule.update({
      where: { id: agendamento.id },
      data: {
        ultimaExecucao,
        proximaExecucao,
      },
    });

    await this.salvarLogsDb(logsParaPersistir);

    return {
      enviados,
      ignorados,
      falhas,
      proximaExecucao,
      ultimaExecucao,
      detalhes,
      logId: logIdGerado,
    };
  }

  private normalizarCanal(metodo?: string | null): NotificationChannel {
    const canal = (metodo ?? config.notification.defaultMethod ?? 'whatsapp').toLowerCase();
    return canal === 'email' ? 'email' : 'whatsapp';
  }

  private calcularProximaExecucao(frequenciaMinutos: number, referencia = new Date()): Date {
    const proxima = new Date(referencia);
    proxima.setMinutes(proxima.getMinutes() + frequenciaMinutos);
    return proxima;
  }

  getLogs(limit = 50) {
    return this.prisma.notificationLog.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private async salvarLogsDb(
    registros: Array<{
      tenantId: string;
      logId: string;
      titularId?: number;
      destinatario?: string;
      canal: NotificationChannel;
      status: string;
      motivo?: string;
      payload?: string;
    }>,
  ) {
    if (!registros.length) return;
    await this.prisma.notificationLog.createMany({ data: registros });
  }

  private montarMensagem(
    destinatario: DestinatarioNotificacao,
    contato: string,
    canal: NotificationChannel,
    template?: { assunto?: string | null; htmlBody?: string | null; textBody?: string | null },
  ) {
    const cobrancaMaisProxima = destinatario.cobrancas[0];
    const mensagem = [
      `Olá, ${destinatario.nome}.`,
      `Identificamos ${destinatario.quantidadeCobrancas} cobrança(s) pendente(s) no valor total de R$ ${destinatario.totalPendente.toFixed(
        2,
      )}.`,
    ];

    if (cobrancaMaisProxima) {
      mensagem.push(
        `O vencimento mais próximo é em ${new Date(cobrancaMaisProxima.vencimento).toLocaleDateString(
          'pt-BR',
        )}.`,
      );
    }

    mensagem.push(
      'Para manter seus benefícios ativos, regularize o pagamento ou fale conosco. Se você já pagou, desconsidere este aviso.',
    );

    const textoFinal = mensagem.join(' ');
    const htmlFinal = `<p>${mensagem[0]}</p><p>${mensagem[1]}</p>${
      cobrancaMaisProxima
        ? `<p>O vencimento mais próximo é em ${new Date(cobrancaMaisProxima.vencimento).toLocaleDateString(
            'pt-BR',
          )}.</p>`
        : ''
    }<p>Para manter seus benefícios ativos, regularize o pagamento ou fale conosco. Se você já pagou, desconsidere este aviso.</p>`;

    return {
      to: contato,
      channel: canal,
      subject: template?.assunto ?? 'Cobrança pendente',
      message: template?.textBody ?? textoFinal,
      text: template?.textBody ?? textoFinal,
      html: template?.htmlBody ?? htmlFinal,
      metadata: {
        tenantId: this.tenantId,
        cobrancas: destinatario.cobrancas,
        totalPendente: destinatario.totalPendente,
      },
      // Campos esperados pelo provider
      phone: canal === 'whatsapp' ? contato : undefined,
      email: canal === 'email' ? contato : undefined,
    } as any;
  }

  private async ensureAgendamento(): Promise<NotificationScheduleModel> {
    const existente = await this.prisma.notificationSchedule.findFirst({
      where: { tenantId: this.tenantId },
    });

    if (existente) return existente;

    const regras = await this.prisma.businessRules.findFirst({
      where: { tenantId: this.tenantId },
    });

    const frequenciaMinutos = (regras?.repeticaoPendenciaDias ?? 1) * 24 * 60;
    const proximaExecucao = this.calcularProximaExecucao(frequenciaMinutos);

    const criado = await this.prisma.notificationSchedule.create({
      data: {
        tenantId: this.tenantId,
        frequenciaMinutos,
        proximaExecucao,
        metodoPreferencial: this.normalizarCanal(regras?.tipoAvisoTaxaVencida ?? undefined),
        ultimaExecucao: new Date(), // impede disparo imediato ao criar agendamento
      },
    });

    this.logger.info('Agendamento de notificação criado automaticamente', {
      tenantId: this.tenantId,
      frequenciaMinutos,
      proximaExecucao,
    });

    return criado;
  }

  private async buscarPendencias(): Promise<ContaReceberComCliente[]> {
    return this.prisma.contaReceber.findMany({
      where: {
        status: {
          in: ['PENDENTE', 'ATRASADO', 'PENDENCIA', 'VENCIDO'],
        },
      },
      include: {
        cliente: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
            cpf: true,
            bloquearNotificacaoRecorrente: true,
            metodoNotificacaoRecorrente: true,
          },
        },
      },
      orderBy: { vencimento: 'asc' },
    });
  }

  private mapearDestinatarios(
    contas: ContaReceberComCliente[],
    metodoPreferencial: string | null,
  ): DestinatarioNotificacao[] {
    const agrupado = new Map<number, DestinatarioNotificacao>();
    const canal = this.normalizarCanal(metodoPreferencial);

    contas.forEach((conta) => {
      if (!conta.cliente) return;
      const existente = agrupado.get(conta.cliente.id);
      const canalCliente = this.normalizarCanal(conta.cliente.metodoNotificacaoRecorrente ?? canal);
      const cobranca = {
        contaId: conta.id,
        descricao: conta.descricao,
        valor: Number(conta.valor ?? 0),
        vencimento: conta.vencimento.toISOString(),
        status: conta.status,
        diasAtraso: this.calcularDiasAtraso(conta.vencimento),
      };

      if (existente) {
        existente.cobrancas.push(cobranca);
        existente.totalPendente += Number(conta.valor ?? 0);
        existente.quantidadeCobrancas += 1;
        existente.proximoVencimento = this.resolverMaisProximo(
          existente.proximoVencimento,
          conta.vencimento.toISOString(),
        );
        agrupado.set(conta.cliente.id, existente);
      } else {
        agrupado.set(conta.cliente.id, {
          titularId: conta.cliente.id,
          nome: conta.cliente.nome,
          email: conta.cliente.email,
          telefone: conta.cliente.telefone,
          bloqueado: !!conta.cliente.bloquearNotificacaoRecorrente,
          metodo: conta.cliente.telefone || canalCliente === 'email' ? canalCliente : canal,
          totalPendente: Number(conta.valor ?? 0),
          proximoVencimento: conta.vencimento.toISOString(),
          quantidadeCobrancas: 1,
          cobrancas: [cobranca],
        });
      }
    });

    return Array.from(agrupado.values()).map((dest) => ({
      ...dest,
      cobrancas: dest.cobrancas.sort(
        (a, b) => new Date(a.vencimento).getTime() - new Date(b.vencimento).getTime(),
      ),
    }));
  }

  private resolverMaisProximo(atual: string | null, novo: string): string {
    if (!atual) return novo;
    const atualDate = new Date(atual);
    const novaDate = new Date(novo);
    return novaDate < atualDate ? novo : atual;
  }

  private calcularDiasAtraso(vencimento: Date): number {
    const hoje = new Date();
    const diff = hoje.getTime() - new Date(vencimento).getTime();
    const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
    return dias > 0 ? dias : 0;
  }

  private temContato(destinatario: DestinatarioNotificacao) {
    if (destinatario.metodo === 'email') return !!destinatario.email;
    return !!destinatario.telefone || !!destinatario.email;
  }
}
