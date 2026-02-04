import config from '../config';
import Logger from '../utils/logger';
import { NotificationApiClient, NotificationChannel } from '../utils/notificationClient';
import { getPrismaForTenant, Prisma } from '../utils/prisma';
import { NotificacaoTemplateService } from './notificacao-template.service';

type BusinessRulesModel = Prisma.BusinessRulesGetPayload<{}>;

export type NotificationFlowType =
  | 'pendencia-periodica'
  | 'aviso-vencimento'
  | 'aviso-pendencia'
  | 'suspensao-preventiva'
  | 'suspensao'
  | 'pos-suspensao';

const DEFAULT_DIAS_AVISO_VENCIMENTO = 2;
const DEFAULT_DIAS_AVISO_PENDENCIA = 1;
const DEFAULT_REPETICAO_PENDENCIA_DIAS = 1;
const DEFAULT_DIAS_SUSPENSAO_PREVENTIVA = 85;
const DEFAULT_DIAS_SUSPENSAO = 90;
const DEFAULT_DIAS_POS_SUSPENSAO = 92;

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
  private regrasNegocio: BusinessRulesModel | null = null;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
    this.logger = new Logger({ service: 'NotificacaoRecorrenteService', tenantId });
    this.apiClient = new NotificationApiClient(tenantId);
    this.templateService = new NotificacaoTemplateService(tenantId);
  }

  async getPainel(tipo: NotificationFlowType = 'pendencia-periodica'): Promise<PainelNotificacao> {
    const agendamento = await this.ensureAgendamento();
    const contas = await this.buscarPendencias(tipo);
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

  async atualizarBloqueio(
    titularId: number,
    bloqueado: boolean,
    tipo: NotificationFlowType = 'pendencia-periodica',
  ): Promise<DestinatarioNotificacao> {
    await this.prisma.titular.update({
      where: { id: titularId },
      data: { bloquearNotificacaoRecorrente: bloqueado },
    });

    const agendamento = await this.ensureAgendamento();
    const contas = await this.buscarPendencias(tipo);
    const destinatarios = this.mapearDestinatarios(contas, agendamento.metodoPreferencial);

    const destinatario = destinatarios.find((d) => d.titularId === titularId);
    if (!destinatario) {
      throw new Error('Cliente não encontrado ou sem cobranças pendentes');
    }

    return destinatario;
  }

  async atualizarMetodo(
    titularId: number,
    metodo: NotificationChannel,
    tipo: NotificationFlowType = 'pendencia-periodica',
  ): Promise<DestinatarioNotificacao> {
    await this.prisma.titular.update({
      where: { id: titularId },
      data: { metodoNotificacaoRecorrente: this.normalizarCanal(metodo) },
    });

    const agendamento = await this.ensureAgendamento();
    const contas = await this.buscarPendencias(tipo);
    const destinatarios = this.mapearDestinatarios(contas, agendamento.metodoPreferencial);

    const destinatario = destinatarios.find((d) => d.titularId === titularId);
    if (!destinatario) {
      throw new Error('Cliente não encontrado ou sem cobranças pendentes');
    }

    return destinatario;
  }

  async dispararLote(
    force = true,
    tipo: NotificationFlowType = 'pendencia-periodica',
  ): Promise<ResultadoDisparo> {
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

    if (!agendamento.ativo && !force) {
      this.logger.warn('Tentativa de disparo com agendamento inativo', { tenant: this.tenantId });
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

    const contas = await this.buscarPendencias(tipo);
    const destinatarios = this.mapearDestinatarios(contas, agendamento.metodoPreferencial);

    let enviados = 0;
    let ignorados = 0;
    let falhas = 0;
    const detalhes: ResultadoDisparo['detalhes'] = [];
    const templateEmail = await this.templateService.obterDefault('email', tipo);
    const templateWhatsapp = await this.templateService.obterDefault('whatsapp', tipo);
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
      const referencias = destinatario.cobrancas.map((c) =>
        this.buildReferenciaEnvio(tipo, c.contaId),
      );
      const payloadBase = this.buildLogPayload(tipo, referencias, destinatario);

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
          payload: payloadBase,
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
          payload: payloadBase,
        });
        continue;
      }

    const payload = this.montarMensagem(
        destinatario,
        contato,
        destinatario.metodo,
        tipo,
        destinatario.metodo === 'email' ? templateEmail || undefined : templateWhatsapp || undefined,
      );
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
          payload: payloadBase,
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
          payload: this.buildLogPayload(tipo, referencias, destinatario, {
            providerResponse: resultado,
          }),
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
          payload: this.buildLogPayload(tipo, referencias, destinatario, {
            providerResponse: resultado,
          }),
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

  getLogs(limit = 50, tipo?: NotificationFlowType) {
    return this.prisma.notificationLog.findMany({
      where: {
        tenantId: this.tenantId,
        ...(tipo
          ? tipo === 'pendencia-periodica'
            ? {
                OR: [
                  { payload: { contains: `"tipo":"${tipo}"` } },
                  { payload: null },
                ],
              }
            : { payload: { contains: `"tipo":"${tipo}"` } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
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

  private buildDefaultEmailHtml({
    destinatario,
    cobranca,
    textoEditavel,
    tipo,
  }: {
    destinatario: DestinatarioNotificacao;
    cobranca?: DestinatarioNotificacao['cobrancas'][0];
    textoEditavel?: string | null;
    tipo: NotificationFlowType;
  }) {
    const tenant = this.tenantId.toLowerCase();
    const displayName = this.getDisplayName(tenant);
    const logoUrl = `https://${tenant}.planvita.com.br/logo.png`;
    const logoTag = `<img src="${logoUrl}" alt="Planvita" style="height:48px;" />`;

    const descricao =
      textoEditavel && textoEditavel.trim().length > 0
        ? textoEditavel
        : cobranca?.descricao ?? 'Cobrança de serviços';

    const valorFormatado = cobranca
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
          cobranca.valor,
        )
      : '—';

    const vencimentoFormatado = cobranca
      ? new Date(cobranca.vencimento).toLocaleDateString('pt-BR')
      : '—';
    const urlBase = `https://${tenant}.planvita.com.br`;
    const urlCobranca = `${urlBase}/cliente`;

    const highlight =
      tipo === 'aviso-vencimento'
        ? 'Lembrete de vencimento'
        : tipo === 'aviso-pendencia'
          ? 'Aviso de pendência'
          : tipo === 'suspensao-preventiva'
            ? 'Aviso de suspensão preventiva'
            : tipo === 'suspensao'
              ? 'Aviso de suspensão'
              : tipo === 'pos-suspensao'
                ? 'Lembrete pós-suspensão'
            : 'Cobrança pendente';

    return `
    <div style="font-family: Arial, sans-serif; background-color: #f4f5f7; padding: 24px;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.06);">
        <div style="background: linear-gradient(135deg, #16a34a, #0d7a35); color: #ffffff; padding: 18px 24px; display: flex; align-items: center; gap: 12px;">
          ${logoTag}
          <div>
            <div style="font-size: 14px; opacity: 0.9;">${displayName}</div>
            <div style="font-size: 12px; opacity: 0.9;">51.121.484/0001-68</div>
          </div>
          <div style="margin-left:auto;font-weight:700;">${highlight}</div>
        </div>
        <div style="padding: 24px; color: #0f172a;">
          <p style="font-size: 16px; margin: 0 0 12px 0;">Olá, ${destinatario.nome}.</p>
          <p style="font-size: 14px; margin: 0 0 12px 0;">
            Lembramos que a sua cobrança gerada por <strong>PLANO FAMILIAR CAMPO DO BOSQUE LTDA</strong>
            no valor de <strong>${valorFormatado}</strong> vence em
            <strong>${vencimentoFormatado}</strong>.
          </p>
          <p style="font-size: 14px; margin: 0 0 16px 0;">
            Descrição da cobrança: ${descricao}
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${urlCobranca}" style="background: #16a34a; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">
              Visualizar cobrança
            </a>
          </div>
          <p style="font-size: 13px; color: #475569;">Clique no botão acima para visualizar a cobrança. Ou acesse: ${urlBase}</p>
        </div>
        <div style="background: #0f172a; color: #e2e8f0; padding: 18px 24px; font-size: 12px;">
          <strong>${displayName}</strong><br/>
          51.121.484/0001-68<br/>
          <a href="${urlBase}" style="color: #a7f3d0;">${urlBase}</a><br/>
          <a href="mailto:pfcampodobosque@gmail.com" style="color: #a7f3d0;">pfcampodobosque@gmail.com</a><br/>
          (71) 3034-7323<br/>
          Avenida Centenário, 21, LOJA 80, Garcia<br/>
          CEP: 40100180<br/>
          Salvador - BA
        </div>
      </div>
    </div>
    `;
  }

  private getDisplayName(tenant: string) {
    if (tenant === 'bosque') return 'PLANO FAMILIAR CAMPO DO BOSQUE LTDA';
    if (tenant === 'pax') return 'PAX PLANVITA';
    return 'LIDER PLANVITA';
  }

  private buildDefaultWhatsappText({
    destinatario,
    cobranca,
    tipo,
  }: {
    destinatario: DestinatarioNotificacao;
    cobranca?: DestinatarioNotificacao['cobrancas'][0];
    tipo: NotificationFlowType;
  }) {
    const tenant = this.tenantId.toLowerCase();
    const displayName = this.getDisplayName(tenant);
    const urlBase = `https://${tenant}.planvita.com.br`;
    const urlCobranca = `${urlBase}/cliente`;
    const valor = cobranca
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
          cobranca.valor,
        )
      : '—';
    const vencimento = cobranca
      ? new Date(cobranca.vencimento).toLocaleDateString('pt-BR')
      : '—';
    const descricao = cobranca?.descricao ?? 'Cobrança de serviços';

    const mensagens: Record<NotificationFlowType, string[]> = {
      'aviso-vencimento': [
        `Olá, ${destinatario.nome}`,
        `Lembrete: sua cobrança de ${valor} vence em ${vencimento}.`,
        `Descrição: ${descricao}.`,
        `Pague ou consulte em: ${urlCobranca}`,
      ],
      'aviso-pendencia': [
        `Olá, ${destinatario.nome}`,
        `Identificamos uma pendência de ${valor} vencida em ${vencimento}.`,
        `Descrição: ${descricao}.`,
        `Regularize em: ${urlCobranca}`,
      ],
      'suspensao-preventiva': [
        `Olá, ${destinatario.nome}`,
        `Seu plano pode ser suspenso em breve por pendência financeira.`,
        `Cobrança de ${valor} vencida em ${vencimento} (${descricao}).`,
        `Evite suspensão regularizando em: ${urlCobranca}`,
      ],
      suspensao: [
        `Olá, ${destinatario.nome}`,
        `Seu plano foi suspenso por pendência financeira.`,
        `Cobrança de ${valor} vencida em ${vencimento} (${descricao}).`,
        `Regularize em: ${urlCobranca}`,
      ],
      'pos-suspensao': [
        `Olá, ${destinatario.nome}`,
        `Seu plano permanece suspenso por pendência financeira.`,
        `Cobrança de ${valor} vencida em ${vencimento} (${descricao}).`,
        `Regularize o pagamento para reativar o plano: ${urlCobranca}`,
      ],
      'pendencia-periodica': [
        `Olá, ${destinatario.nome}`,
        `Sua cobrança gerada por ${displayName} no valor de ${valor} vence em ${vencimento}.`,
        `Descrição: ${descricao}.`,
        `Visualize/regularize em: ${urlCobranca}`,
      ],
    };

    return mensagens[tipo].join('\n');
  }

  private montarMensagem(
    destinatario: DestinatarioNotificacao,
    contato: string,
    canal: NotificationChannel,
    tipo: NotificationFlowType,
    template?: { assunto?: string | null; htmlBody?: string | null; textBody?: string | null },
  ) {
    const cobrancaMaisProxima = destinatario.cobrancas[0];
    const templateVars = this.buildTemplateVars(destinatario, cobrancaMaisProxima);

    const metadata = {
      tenantId: this.tenantId,
      cobrancas: destinatario.cobrancas,
      totalPendente: destinatario.totalPendente,
      quantidadeCobrancas: destinatario.quantidadeCobrancas,
    };

    if (canal === 'whatsapp') {
      const textoWhatsapp = this.applyTemplate(
        template?.textBody ??
          template?.htmlBody ??
          this.buildDefaultWhatsappText({
            destinatario,
            cobranca: cobrancaMaisProxima,
            tipo,
          }),
        templateVars,
      );

      return {
        to: contato,
        channel: canal,
        message: textoWhatsapp,
        text: textoWhatsapp,
        metadata,
        phone: contato,
      } as any;
    }

    const mensagem = this.buildEmailTextoPadrao(destinatario, tipo, cobrancaMaisProxima);

    const textoFinal = this.applyTemplate(
      template?.textBody ?? mensagem.join(' '),
      templateVars,
    );
    const htmlFinal =
      template?.htmlBody
        ? this.applyTemplate(template.htmlBody, templateVars)
        : this.buildDefaultEmailHtml({
            destinatario,
            cobranca: cobrancaMaisProxima,
            textoEditavel: textoFinal,
            tipo,
          });

    return {
      to: contato,
      channel: canal,
      subject: template?.assunto ?? this.resolveAssuntoPadrao(tipo),
      message: textoFinal,
      text: textoFinal,
      html: htmlFinal,
      metadata,
    } as any;
  }

  private resolveAssuntoPadrao(tipo: NotificationFlowType) {
    switch (tipo) {
      case 'aviso-vencimento':
        return 'Lembrete de vencimento';
      case 'aviso-pendencia':
        return 'Aviso de pendência';
      case 'suspensao-preventiva':
        return 'Aviso de suspensão preventiva';
      case 'suspensao':
        return 'Aviso de suspensão';
      case 'pos-suspensao':
        return 'Plano suspenso: regularize para reativação';
      default:
        return 'Cobrança pendente';
    }
  }

  private buildEmailTextoPadrao(
    destinatario: DestinatarioNotificacao,
    tipo: NotificationFlowType,
    cobrancaMaisProxima?: DestinatarioNotificacao['cobrancas'][0],
  ) {
    const base: string[] = [`Olá, ${destinatario.nome}.`];
    const valorTotal = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(destinatario.totalPendente);

    switch (tipo) {
      case 'aviso-vencimento':
        base.push(
          `Lembrete: sua cobrança de ${valorTotal} vence em ${cobrancaMaisProxima ? new Date(cobrancaMaisProxima.vencimento).toLocaleDateString('pt-BR') : 'breve'}.`,
        );
        base.push('Antecipe o pagamento para manter seus benefícios ativos.');
        break;
      case 'aviso-pendencia':
        base.push(
          `Identificamos uma pendência de ${valorTotal} vencida ${
            cobrancaMaisProxima
              ? `em ${new Date(cobrancaMaisProxima.vencimento).toLocaleDateString('pt-BR')}`
              : ''
          }.`,
        );
        base.push('Regularize o quanto antes ou entre em contato conosco.');
        break;
      case 'suspensao-preventiva':
        base.push(
          `Seu plano pode ser suspenso em breve devido a pendências que somam ${valorTotal}.`,
        );
        base.push('Evite a suspensão realizando o pagamento ou falando com nosso time.');
        break;
      case 'suspensao':
        base.push(
          `Seu plano foi suspenso devido a pendências que somam ${valorTotal}.`,
        );
        base.push('Regularize o pagamento para restabelecer seus benefícios.');
        break;
      case 'pos-suspensao':
        base.push(
          `Seu plano permanece suspenso e há pendências no valor total de ${valorTotal}.`,
        );
        base.push(
          'Assim que o pagamento for regularizado, seu plano poderá ser reativado.',
        );
        break;
      default:
        base.push(
          `Identificamos ${destinatario.quantidadeCobrancas} cobrança(s) pendente(s) no valor total de ${valorTotal}.`,
        );
        if (cobrancaMaisProxima) {
          base.push(
            `O vencimento mais próximo é em ${new Date(
              cobrancaMaisProxima.vencimento,
            ).toLocaleDateString('pt-BR')}.`,
          );
        }
        base.push(
          'Para manter seus benefícios ativos, regularize o pagamento ou fale conosco. Se você já pagou, desconsidere este aviso.',
        );
    }

    return base;
  }

  private applyTemplate(template: string, vars: Record<string, string>) {
    if (!template) return '';
    let output = template;
    Object.entries(vars).forEach(([key, value]) => {
      output = output.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
    });
    return output;
  }

  private buildTemplateVars(
    destinatario: DestinatarioNotificacao,
    cobranca?: DestinatarioNotificacao['cobrancas'][0],
  ) {
    const tenant = this.tenantId.toLowerCase();
    const displayName = this.getDisplayName(tenant);
    const urlBase = `https://${tenant}.planvita.com.br`;
    const urlCobranca = `${urlBase}/cliente`;
    const valor = cobranca
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
          cobranca.valor,
        )
      : '—';
    const vencimento = cobranca
      ? new Date(cobranca.vencimento).toLocaleDateString('pt-BR')
      : '—';
    const descricao = cobranca?.descricao ?? 'Cobrança de serviços';

    return {
      nomeCliente: destinatario.nome,
      nomeEmpresa: displayName,
      valor,
      vencimento,
      descricao,
      linkCobranca: urlCobranca,
      tenant,
    };
  }

  private async ensureAgendamento(): Promise<NotificationScheduleModel> {
    const existente = await this.prisma.notificationSchedule.findFirst({
      where: { tenantId: this.tenantId },
    });

    if (existente) return existente;

    const regras = await this.obterRegrasNegocio();

    const frequenciaMinutos =
      (regras?.repeticaoPendenciaDias ?? DEFAULT_REPETICAO_PENDENCIA_DIAS) * 24 * 60;
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

  private async buscarPendencias(tipo: NotificationFlowType): Promise<ContaReceberComCliente[]> {
    const regras = await this.obterRegrasNegocio();
    const contas = await this.prisma.contaReceber.findMany({
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

    const diasAvisoVencimento = regras?.diasAvisoVencimento ?? DEFAULT_DIAS_AVISO_VENCIMENTO;
    const diasAvisoPendencia = regras?.diasAvisoPendencia ?? DEFAULT_DIAS_AVISO_PENDENCIA;
    const diasSuspensaoPreventiva =
      regras?.diasSuspensaoPreventiva ?? DEFAULT_DIAS_SUSPENSAO_PREVENTIVA;
    const diasSuspensao = regras?.diasSuspensao ?? DEFAULT_DIAS_SUSPENSAO;
    const diasPosSuspensao = regras?.diasPosSuspensao ?? DEFAULT_DIAS_POS_SUSPENSAO;

    const contasFiltradas = contas.filter((conta) => {
      const diasParaVencer = this.calcularDiasParaVencer(conta.vencimento);
      const diasAtraso = this.calcularDiasAtraso(conta.vencimento);

      switch (tipo) {
        case 'aviso-vencimento':
          return diasParaVencer >= 0 && diasParaVencer <= diasAvisoVencimento;
        case 'aviso-pendencia':
          return diasAtraso >= diasAvisoPendencia;
        case 'suspensao-preventiva':
          return diasAtraso >= diasSuspensaoPreventiva;
        case 'suspensao':
          return diasAtraso >= diasSuspensao;
        case 'pos-suspensao':
          return diasAtraso >= diasPosSuspensao;
        case 'pendencia-periodica':
        default:
          return diasAtraso >= Math.max(0, diasAvisoPendencia);
      }
    });

    if (tipo === 'pendencia-periodica') return contasFiltradas;

    const referenciasEnviadas = await this.carregarReferenciasEnviadas(tipo);
    return contasFiltradas.filter(
      (conta) => !referenciasEnviadas.has(this.buildReferenciaEnvio(tipo, conta.id)),
    );
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

  private async obterRegrasNegocio(): Promise<BusinessRulesModel | null> {
    if (this.regrasNegocio) return this.regrasNegocio;

    this.regrasNegocio = await this.prisma.businessRules.findFirst({
      where: { tenantId: this.tenantId },
    });

    return this.regrasNegocio;
  }

  private buildReferenciaEnvio(tipo: NotificationFlowType, contaId: number) {
    return `${tipo}:${contaId}`;
  }

  private async carregarReferenciasEnviadas(tipo: NotificationFlowType): Promise<Set<string>> {
    const logs = await this.prisma.notificationLog.findMany({
      where: {
        tenantId: this.tenantId,
        status: 'enviado',
        payload: { contains: `"tipo":"${tipo}"` },
      },
      select: { payload: true },
    });

    const referencias = new Set<string>();

    logs.forEach((log) => {
      if (!log.payload) return;
      try {
        const parsed = JSON.parse(log.payload);
        const lista: string[] = Array.isArray(parsed.referencias)
          ? parsed.referencias
          : parsed.referencia
            ? [parsed.referencia]
            : [];
        lista.forEach((ref) => referencias.add(String(ref)));
      } catch (error) {
        this.logger.warn('Falha ao interpretar payload de log de notificação', {
          tipo,
          tenantId: this.tenantId,
        });
      }
    });

    return referencias;
  }

  private buildLogPayload(
    tipo: NotificationFlowType,
    referencias: string[],
    destinatario: DestinatarioNotificacao,
    extra?: Record<string, unknown>,
  ) {
    return JSON.stringify({
      tipo,
      referencias,
      titularId: destinatario.titularId,
      cobrancas: destinatario.cobrancas.map((c) => ({
        contaId: c.contaId,
        vencimento: c.vencimento,
        valor: c.valor,
        status: c.status,
      })),
      metodo: destinatario.metodo,
      ...(extra ?? {}),
    });
  }

  private calcularDiasParaVencer(vencimento: Date): number {
    const hoje = new Date();
    const diff = new Date(vencimento).getTime() - hoje.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
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
