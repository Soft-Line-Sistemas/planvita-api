import Logger from '../utils/logger';
import { buildStandardEmailTemplate, formatTextAsHtmlParagraphs } from '../utils/emailTemplate';
import {
  AsaasClient,
  AsaasWebhookEvent,
  resolveAsaasCredentials,
  AsaasPaymentPayload,
  AsaasCreditCardTokenizePayload,
} from '../utils/asaasClient';
import { getPrismaForTenant, Prisma } from '../utils/prisma';
import { NotificationApiClient } from '../utils/notificationClient';
import { decryptText, encryptText } from '../utils/crypto';

type ContaReceberWithCliente = Prisma.ContaReceberGetPayload<{
  include: {
    cliente: true;
  };
}>;
const STATUS_PLANO_PENDENTE_ASSINATURA = 'PENDENTE_ASSINATURA';
const TIPOS_ASSINATURA_OBRIGATORIOS = [
  'TITULAR_ASSINATURA_1',
  'TITULAR_ASSINATURA_2',
  'CORRESPONSAVEL_ASSINATURA_1',
  'CORRESPONSAVEL_ASSINATURA_2',
] as const;
const COMISSAO_ADESAO_DELAY_MS =
  process.env.NODE_ENV === 'development'
    ? 60 * 60 * 1000
    : 35 * 24 * 60 * 60 * 1000;
const STATUS_RECEBIMENTO_COMISSAO = ['RECEBIDO', 'CONFIRMADO'] as const;

type CreditCardSubscriptionInput = {
  card: {
    holderName: string;
    holderCpf: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  holderInfo: {
    name: string;
    email?: string;
    cpfCnpj: string;
    postalCode?: string;
    addressNumber?: string;
    addressComplement?: string;
    phone?: string;
    mobilePhone?: string;
  };
  remoteIp: string;
};

export class AsaasIntegrationService {
  private prisma;
  private logger: Logger;
  private client: AsaasClient | null = null;
  private notificationClient: NotificationApiClient;
  private enabled: boolean = false;

  constructor(private tenantId: string, private requestId?: string) {
    this.prisma = getPrismaForTenant(tenantId);
    this.logger = new Logger({
      service: 'AsaasIntegrationService',
      tenantId,
      requestId,
    });
    this.notificationClient = new NotificationApiClient(tenantId);

    try {
      const credentials = resolveAsaasCredentials(tenantId);
      this.enabled = credentials.enabled;
      this.client = credentials.enabled ? new AsaasClient(tenantId, requestId) : null;
    } catch (error: any) {
      this.logger.warn('Asaas credentials not resolved; integration disabled', {
        tenantId,
        error: error?.message,
      });
      this.enabled = false;
      this.client = null;
    }
  }

  isEnabled() {
    return this.enabled && !!this.client;
  }

  async reenviarLinkCobrancaPendente(titularId: number): Promise<string | null> {
    if (!this.client) return null;

    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: {
        id: true,
        nome: true,
        email: true,
        cpf: true,
        asaasCustomerId: true,
        plano: { select: { valorMensal: true } },
        contasReceber: {
          where: { status: 'PENDENTE' },
          orderBy: { vencimento: 'asc' },
          take: 1,
        },
      },
    });

    if (!titular) return null;

    const contaPendente = titular.contasReceber[0] ?? null;

    if (contaPendente?.asaasPaymentId) {
      try {
        const existing = await this.client.getPaymentById(contaPendente.asaasPaymentId);
        const url = (existing as any)?.invoiceUrl ?? (existing as any)?.bankSlipUrl ?? contaPendente.paymentUrl;
        if (url) return url;
      } catch {
        // fall through to create new
      }
    }

    // O Asaas exige o customer para criar uma cobrança. A resolução também tenta
    // persistir o vínculo local, mas uma falha nesse armazenamento não pode
    // impedir a emissão da cobrança quando já temos um customer válido no Asaas.
    const customerId = titular.asaasCustomerId ?? await this.ensureCustomerForTitular(titularId);

    if (!customerId) return null;

    const valor = titular.plano?.valorMensal ?? contaPendente?.valor;
    if (!valor) return null;

    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 3);
    const dueDate = vencimento.toISOString().split('T')[0];
    // Referência estável: se o Asaas aceitar a cobrança e a gravação local
    // falhar, a próxima tentativa a encontra e reconcilia em vez de duplicar.
    const externalReference = `titular-adesao-${this.tenantId}-${titularId}`;

    const payload: AsaasPaymentPayload = {
      customer: customerId,
      billingType: 'BOLETO',
      value: valor,
      dueDate,
      description: `Adesão — ${titular.nome}`,
      externalReference,
    };

    let payment: any = null;
    try {
      const existing = await this.client!.getPayments({ externalReference, limit: 1, offset: 0 });
      payment = existing?.data?.[0] ?? null;
    } catch (error: any) {
      // A consulta é uma proteção contra duplicidade. Se ela falhar, ainda
      // tentamos emitir a cobrança solicitada e registramos o ocorrido.
      this.logger.warn('Falha ao consultar cobrança de adesão existente no Asaas', {
        tenantId: this.tenantId,
        titularId,
        externalReference,
        error: error?.message,
      });
    }

    try {
      payment = payment ?? await this.client!.createPayment(payload);
    } catch (error: any) {
      this.logger.warn('Falha ao criar nova cobrança de adesão no Asaas', {
        titularId,
        externalReference,
        error: error?.message,
      });
      return null;
    }

    const paymentId = String(payment?.id ?? '').trim() || undefined;
    const paymentUrl = payment?.invoiceUrl ?? payment?.bankSlipUrl ?? payment?.paymentLink ?? null;
    const vencimentoProvider = payment?.dueDate ? new Date(payment.dueDate) : vencimento;

    try {
      if (contaPendente) {
        await this.prisma.contaReceber.update({
          where: { id: contaPendente.id },
          data: {
            paymentUrl,
            asaasPaymentId: paymentId,
            vencimento: vencimentoProvider,
          },
        });
      } else {
        await this.prisma.contaReceber.create({
          data: {
            clienteId: titularId,
            descricao: `Adesão — ${titular.nome}`,
            valor,
            vencimento: vencimentoProvider,
            status: 'PENDENTE',
            paymentUrl,
            asaasPaymentId: paymentId,
          },
        });
      }
    } catch (error: any) {
      // A cobrança já foi criada no provedor. Não a tratamos como falha para o
      // cliente; a externalReference estável permite reconciliar o paymentId na
      // próxima chamada ou rotina de sincronização.
      this.logger.warn('Cobrança de adesão criada no Asaas, mas não persistida localmente', {
        tenantId: this.tenantId,
        titularId,
        paymentId,
        externalReference,
        error: error?.message,
      });
    }

    return paymentUrl;
  }

  private isStatusPagamentoConfirmado(status: string): boolean {
    return status === 'RECEBIDO' || status === 'CONFIRMADO';
  }

  private isStatusPagamentoRecebidoNoAsaas(status?: string | null): boolean {
    const normalized = String(status ?? '').toUpperCase();
    return (
      normalized === 'RECEIVED' ||
      normalized === 'RECEIVED_IN_CASH' ||
      normalized === 'CONFIRMED'
    );
  }

  private async atualizarStatusContratoAposPagamentoTx(tx: any, titularId: number) {
    const titular = await tx.titular.findUnique({
      where: { id: titularId },
      select: { id: true, statusPlano: true },
    });
    if (!titular) return;

    const statusAtual = String(titular.statusPlano ?? '').toUpperCase();
    if (statusAtual === 'CANCELADO') return;

    const assinaturas = await (tx as any).assinaturaDigital.findMany({
      where: { titularId },
      select: { tipo: true },
    });

    const assinouTudo = TIPOS_ASSINATURA_OBRIGATORIOS.every((tipo) =>
      assinaturas.some((assinatura: { tipo: string }) => assinatura.tipo === tipo),
    );

    const proximoStatus = assinouTudo ? 'ATIVO' : STATUS_PLANO_PENDENTE_ASSINATURA;
    if (proximoStatus === titular.statusPlano) return;

    await tx.titular.update({
      where: { id: titularId },
      data: { statusPlano: proximoStatus },
    });
  }

  private isErroCobrancaAsaasNaoPendente(error: any): boolean {
    if (Number(error?.status) !== 400) return false;

    const rawErrors = error?.body?.errors;
    const errors = Array.isArray(rawErrors)
      ? rawErrors
      : rawErrors && typeof rawErrors === 'object'
        ? Object.values(rawErrors)
        : [];

    return errors.some((item: any) => {
      const code = String(item?.code ?? '').toLowerCase();
      const description = String(item?.description ?? '').toLowerCase();
      return code === 'invalid_action' && description.includes('não está pendente');
    });
  }

  private normalizarTelefoneWhatsapp(telefone?: string | null): string | null {
    if (!telefone) return null;
    const digitos = telefone.replace(/\D/g, '');
    if (!digitos) return null;
    return digitos.length > 11 ? `+${digitos}` : `+55${digitos}`;
  }

  private formatarDataCurta(data?: Date | null): string {
    if (!data) return '-';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(data);
  }

  private async registrarLogNotificacaoConfirmacao(args: {
    titularId?: number;
    destinatario?: string | null;
    canal: 'email' | 'whatsapp';
    status: 'enviado' | 'falha' | 'ignorado';
    motivo?: string;
    payload?: Record<string, unknown>;
    logId: string;
  }): Promise<void> {
    try {
      await this.prisma.notificationLog.create({
        data: {
          tenantId: this.tenantId,
          logId: args.logId,
          titularId: args.titularId,
          destinatario: args.destinatario ?? undefined,
          canal: args.canal,
          status: args.status,
          motivo: args.motivo,
          payload: args.payload ? JSON.stringify(args.payload) : undefined,
        },
      });
    } catch (error: any) {
      this.logger.warn('Falha ao registrar log de notificação de confirmação', {
        tenantId: this.tenantId,
        titularId: args.titularId,
        canal: args.canal,
        error: error?.message,
      });
    }
  }

  private async enviarConfirmacaoAssinatura(payload: {
    titularId: number;
    nome: string;
    email?: string | null;
    telefone?: string | null;
    nomeResponsavelFinanceiro?: string | null;
    telefoneResponsavelFinanceiro?: string | null;
    valor?: number | null;
    dataVencimento?: Date | null;
    descricao?: string | null;
    paymentUrl?: string | null;
    paymentId: string;
  }): Promise<void> {
    const assunto = 'Assinatura confirmada';
    const valor = Number(payload.valor ?? 0).toFixed(2);
    const dataVencimento = this.formatarDataCurta(payload.dataVencimento);
    const descricao = payload.descricao?.trim() || 'Assinatura do plano';
    const link = payload.paymentUrl?.trim();

    const mensagemBase =
      `Olá, ${payload.nome}! Confirmamos o pagamento da sua assinatura (${descricao}). ` +
      `Valor: R$ ${valor}. Vencimento: ${dataVencimento}.` +
      (link ? ` Link do comprovante/cobrança: ${link}` : '') +
      ' Seu plano está ativo.';

    const logBaseId = `assinatura-confirmada:${payload.paymentId}`;
    const logEmailExistente = await this.prisma.notificationLog.findFirst({
      where: {
        tenantId: this.tenantId,
        logId: `${logBaseId}:email`,
        status: 'enviado',
      },
      select: { id: true },
    });

    const logWhatsappTitularId = `${logBaseId}:whatsapp:titular`;
    const logWhatsappResponsavelId = `${logBaseId}:whatsapp:responsavel-financeiro`;
    const [logWhatsappTitularExistente, logWhatsappResponsavelExistente] = await Promise.all([
      this.prisma.notificationLog.findFirst({
        where: {
          tenantId: this.tenantId,
          logId: logWhatsappTitularId,
          status: 'enviado',
        },
        select: { id: true },
      }),
      this.prisma.notificationLog.findFirst({
        where: {
          tenantId: this.tenantId,
          logId: logWhatsappResponsavelId,
          status: 'enviado',
        },
        select: { id: true },
      }),
    ]);

    if (!logEmailExistente) {
      if (!payload.email) {
        await this.registrarLogNotificacaoConfirmacao({
          titularId: payload.titularId,
          canal: 'email',
          status: 'ignorado',
          motivo: 'titular sem e-mail para confirmação',
          logId: `${logBaseId}:email`,
        });
      } else {
        const html = buildStandardEmailTemplate({
          title: `Olá, ${payload.nome}`,
          intro: 'Seu pagamento foi confirmado com sucesso.',
          sections: [
            {
              html: formatTextAsHtmlParagraphs(mensagemBase),
            },
          ],
          footerNote: 'Se precisar, entre em contato com o suporte pelo aplicativo.',
        });
        const response = await this.notificationClient.send({
          to: payload.email,
          channel: 'email',
          subject: assunto,
          message: mensagemBase,
          html,
          metadata: {
            flow: 'assinatura-confirmada',
            paymentId: payload.paymentId,
            titularId: payload.titularId,
          },
        });
        await this.registrarLogNotificacaoConfirmacao({
          titularId: payload.titularId,
          destinatario: payload.email,
          canal: 'email',
          status: response.success ? 'enviado' : 'falha',
          motivo: response.error,
          logId: `${logBaseId}:email`,
        });
      }
    }

    const destinatariosWhatsapp = [
      {
        key: 'titular',
        nome: payload.nome,
        telefone: payload.telefone,
        logId: logWhatsappTitularId,
        jaEnviado: !!logWhatsappTitularExistente,
      },
      {
        key: 'responsavel-financeiro',
        nome: payload.nomeResponsavelFinanceiro || 'Responsável financeiro',
        telefone: payload.telefoneResponsavelFinanceiro,
        logId: logWhatsappResponsavelId,
        jaEnviado: !!logWhatsappResponsavelExistente,
      },
    ] as const;

    const telefonesProcessados = new Set<string>();
    for (const destinatario of destinatariosWhatsapp) {
      if (destinatario.jaEnviado) {
        continue;
      }

      const telefoneWhatsapp = this.normalizarTelefoneWhatsapp(destinatario.telefone);
      if (!telefoneWhatsapp) {
        await this.registrarLogNotificacaoConfirmacao({
          titularId: payload.titularId,
          canal: 'whatsapp',
          status: 'ignorado',
          motivo: `${destinatario.nome} sem WhatsApp para confirmação`,
          logId: destinatario.logId,
        });
        continue;
      }

      if (telefonesProcessados.has(telefoneWhatsapp)) {
        await this.registrarLogNotificacaoConfirmacao({
          titularId: payload.titularId,
          destinatario: telefoneWhatsapp,
          canal: 'whatsapp',
          status: 'ignorado',
          motivo: 'número já notificado nesta confirmação',
          logId: destinatario.logId,
        });
        continue;
      }

      const response = await this.notificationClient.send({
        to: telefoneWhatsapp,
        phone: telefoneWhatsapp,
        channel: 'whatsapp',
        message: mensagemBase,
        metadata: {
          flow: 'assinatura-confirmada',
          paymentId: payload.paymentId,
          titularId: payload.titularId,
          destinatario: destinatario.key,
        },
      });

      await this.registrarLogNotificacaoConfirmacao({
        titularId: payload.titularId,
        destinatario: telefoneWhatsapp,
        canal: 'whatsapp',
        status: response.success ? 'enviado' : 'falha',
        motivo: response.error,
        logId: destinatario.logId,
      });

      if (response.success) {
        telefonesProcessados.add(telefoneWhatsapp);
      }
    }
  }

  private buildPublicLink(path: string, token: string): string {
    const base = (process.env.FRONTEND_BASE_URL || '').replace(/\/$/, '') || 'https://planvita.com.br';
    const url = new URL(`${base}${path}`);
    url.searchParams.set('token', token);
    url.searchParams.set('tenant', this.tenantId);
    return url.toString();
  }

  private async enviarLinkCriacaoSenha(payload: {
    titularId: number;
    nome: string;
    email?: string | null;
    telefone?: string | null;
    nomeResponsavelFinanceiro?: string | null;
    telefoneResponsavelFinanceiro?: string | null;
    confirmedAt: Date;
  }): Promise<void> {
    const logId = `primeiro-pagamento-link-senha:${payload.titularId}`;
    const jaEnviado = await this.prisma.notificationLog.findFirst({
      where: { tenantId: this.tenantId, logId, status: 'enviado' },
      select: { id: true },
    });
    if (jaEnviado) return;

    const { ClienteAuthService } = await import('./cliente-auth.service');
    const authService = new ClienteAuthService(this.tenantId);

    let linkToken: string | undefined;
    try {
      const start = await authService.startFirstAccessByTitularId(payload.titularId, undefined, true);
      linkToken = (start as any)?.dev?.token ?? undefined;
    } catch (error: any) {
      this.logger.warn('Falha ao gerar token de primeiro acesso para envio pós-pagamento', {
        tenantId: this.tenantId,
        titularId: payload.titularId,
        error: error?.message,
      });
      return;
    }

    const link = linkToken
      ? this.buildPublicLink('/cliente?modo=primeiro-acesso', linkToken)
      : `${(process.env.FRONTEND_BASE_URL || '').replace(/\/$/, '') || 'https://planvita.com.br'}/cliente?modo=primeiro-acesso&tenant=${this.tenantId}`;

    const mensagem =
      `Olá, ${payload.nome}! Seu pagamento foi confirmado com sucesso. ` +
      `Agora você pode criar sua senha e acessar o aplicativo. ` +
      `Clique no link para criar sua senha: ${link}`;
    const htmlCriacaoSenha = buildStandardEmailTemplate({
      title: `Olá, ${payload.nome}`,
      intro: 'Seu pagamento foi confirmado e seu acesso já pode ser ativado.',
      sections: [
        {
          html: formatTextAsHtmlParagraphs(
            'Agora você pode criar sua senha e acessar o aplicativo normalmente.',
          ),
        },
      ],
      cta: {
        label: 'Criar minha senha',
        href: link,
      },
      footerNote: 'Se você não conseguir abrir o botão, use o link enviado também no texto deste e-mail.',
    });

    const destinatarios: Array<{ canal: 'email' | 'whatsapp'; to: string; logSuffix: string }> = [];

    if (payload.email) {
      destinatarios.push({ canal: 'email', to: payload.email, logSuffix: ':email' });
    }

    const telefoneWhatsapp = this.normalizarTelefoneWhatsapp(payload.telefone);
    if (telefoneWhatsapp) {
      destinatarios.push({ canal: 'whatsapp', to: telefoneWhatsapp, logSuffix: ':whatsapp' });
    }

    const telefoneResponsavel = this.normalizarTelefoneWhatsapp(payload.telefoneResponsavelFinanceiro);
    if (telefoneResponsavel && telefoneResponsavel !== telefoneWhatsapp) {
      destinatarios.push({ canal: 'whatsapp', to: telefoneResponsavel, logSuffix: ':whatsapp:responsavel' });
    }

    for (const dest of destinatarios) {
      const destLogId = `${logId}${dest.logSuffix}`;
      const jaEnviadoDest = await this.prisma.notificationLog.findFirst({
        where: { tenantId: this.tenantId, logId: destLogId, status: 'enviado' },
        select: { id: true },
      });
      if (jaEnviadoDest) continue;

      const response = await this.notificationClient.send({
        to: dest.to,
        channel: dest.canal,
        subject: 'Pagamento confirmado — Crie sua senha de acesso',
        message: mensagem,
        ...(dest.canal === 'email' ? { html: htmlCriacaoSenha } : {}),
        metadata: { flow: 'primeiro-pagamento-link-senha', titularId: payload.titularId },
      });

      await this.prisma.notificationLog.create({
        data: {
          tenantId: this.tenantId,
          logId: destLogId,
          titularId: payload.titularId,
          destinatario: dest.to,
          canal: dest.canal,
          status: response.success ? 'enviado' : 'falha',
          motivo: response.error,
        },
      });
    }

    this.logger.info('Link de criação de senha enviado após confirmação de pagamento', {
      tenantId: this.tenantId,
      titularId: payload.titularId,
    });
  }

  private async agendarNotificacaoContratoObrigatorio(payload: {
    titularId: number;
    nome: string;
    email?: string | null;
    telefone?: string | null;
    nomeResponsavelFinanceiro?: string | null;
    telefoneResponsavelFinanceiro?: string | null;
    confirmedAt: Date;
  }): Promise<void> {
    // Registra no log de notificação um job de "contrato pendente" para ser disparado
    // pelo sistema de notificações recorrentes em ~24h após o pagamento.
    // A mensagem será enviada apenas via WhatsApp, sem bloquear o acesso.
    const logId = `contrato-pendente-agendado:${payload.titularId}`;
    const jaAgendado = await this.prisma.notificationLog.findFirst({
      where: { tenantId: this.tenantId, logId, status: { in: ['enviado', 'agendado'] } },
      select: { id: true },
    });
    if (jaAgendado) return;

    const prazo24h = new Date(payload.confirmedAt.getTime() + 24 * 60 * 60 * 1000);

    await this.prisma.notificationLog.create({
      data: {
        tenantId: this.tenantId,
        logId,
        titularId: payload.titularId,
        canal: 'whatsapp',
        status: 'agendado',
        motivo: `Assinatura de contrato pendente — enviar após ${prazo24h.toISOString()}`,
        payload: JSON.stringify({
          flow: 'contrato-pendente',
          titularId: payload.titularId,
          nome: payload.nome,
          telefone: this.normalizarTelefoneWhatsapp(payload.telefone),
          telefoneResponsavel: this.normalizarTelefoneWhatsapp(payload.telefoneResponsavelFinanceiro),
          enviarApos: prazo24h.toISOString(),
        }),
      },
    });

    this.logger.info('Notificação de contrato pendente agendada para 24h após pagamento', {
      tenantId: this.tenantId,
      titularId: payload.titularId,
      enviarApos: prazo24h.toISOString(),
    });
  }

  private arredondarMoeda(valor: number): number {
    return Math.round((valor + Number.EPSILON) * 100) / 100;
  }

  private adicionarMesesPreservandoDia(dataBase: Date, meses: number): Date {
    const data = new Date(dataBase);
    const diaOriginal = data.getDate();
    const alvo = new Date(data.getFullYear(), data.getMonth() + meses, 1);
    const ultimoDiaMesAlvo = new Date(
      alvo.getFullYear(),
      alvo.getMonth() + 1,
      0,
    ).getDate();

    alvo.setDate(Math.min(diaOriginal, ultimoDiaMesAlvo));
    alvo.setHours(0, 0, 0, 0);
    return alvo;
  }

  private sanitizeDigits(value?: string | null): string | undefined {
    if (!value) return undefined;
    const digits = String(value).replace(/\D/g, '');
    return digits || undefined;
  }

  private sanitizeCpfCnpj(value?: string | null): string | undefined {
    const digits = this.sanitizeDigits(value);
    if (!digits) return undefined;
    if (digits.length === 11) {
      return this.isValidCpf(digits) ? digits : undefined;
    }
    if (digits.length === 14) {
      return this.isValidCnpj(digits) ? digits : undefined;
    }
    return undefined;
  }

  private sanitizePhone(value?: string | null): string | undefined {
    const digits = this.sanitizeDigits(value);
    if (!digits) return undefined;
    if (digits.length < 10 || digits.length > 13) return undefined;
    return digits;
  }

  private sanitizePostalCode(value?: string | null): string | undefined {
    const digits = this.sanitizeDigits(value);
    if (!digits) return undefined;
    return digits.length === 8 ? digits : undefined;
  }

  private sanitizeEmail(value?: string | null): string | undefined {
    if (!value) return undefined;
    const email = String(value).trim().toLowerCase();
    if (!email || !email.includes('@')) return undefined;
    return email;
  }

  private sanitizeState(value?: string | null): string | undefined {
    if (!value) return undefined;
    const state = String(value).trim().toUpperCase();
    return /^[A-Z]{2}$/.test(state) ? state : undefined;
  }

  private isValidCpf(cpf: string): boolean {
    if (!/^\d{11}$/.test(cpf)) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    const calcDigit = (base: string, factor: number) => {
      let total = 0;
      for (const digit of base) {
        total += Number(digit) * factor--;
      }
      const remainder = total % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };

    const first = calcDigit(cpf.slice(0, 9), 10);
    const second = calcDigit(cpf.slice(0, 9) + first.toString(), 11);
    return cpf.endsWith(`${first}${second}`);
  }

  private isValidCnpj(cnpj: string): boolean {
    if (!/^\d{14}$/.test(cnpj)) return false;
    if (/^(\d)\1{13}$/.test(cnpj)) return false;

    const calcDigit = (base: string, weights: number[]) => {
      const total = base
        .split('')
        .reduce((sum, digit, index) => sum + Number(digit) * weights[index], 0);
      const remainder = total % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };

    const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const first = calcDigit(cnpj.slice(0, 12), firstWeights);
    const second = calcDigit(cnpj.slice(0, 12) + first.toString(), secondWeights);
    return cnpj.endsWith(`${first}${second}`);
  }

  private async findExistingCustomerOnAsaas(params: {
    externalReference: string;
    cpfCnpj?: string;
    email?: string;
  }): Promise<string | null> {
    if (!this.client) return null;

    const byExternalRef = await this.client.getCustomers({
      externalReference: params.externalReference,
      limit: 1,
      offset: 0,
    });
    const customerByExternalRef = byExternalRef?.data?.[0]?.id as string | undefined;
    if (customerByExternalRef) return customerByExternalRef;

    if (params.cpfCnpj) {
      const byCpf = await this.client.getCustomers({
        cpfCnpj: params.cpfCnpj,
        limit: 1,
        offset: 0,
      });
      const customerByCpf = byCpf?.data?.[0]?.id as string | undefined;
      if (customerByCpf) return customerByCpf;
    }

    if (params.email) {
      const byEmail = await this.client.getCustomers({
        email: params.email,
        limit: 1,
        offset: 0,
      });
      const customerByEmail = byEmail?.data?.[0]?.id as string | undefined;
      if (customerByEmail) return customerByEmail;
    }

    return null;
  }

  private adicionarAtrasoComissao(base: Date): Date {
    const resultado = new Date(base);
    resultado.setTime(resultado.getTime() + COMISSAO_ADESAO_DELAY_MS);
    return resultado;
  }

  private calcularValorComissao(
    vendedor: {
      valorComissaoIndicacao?: number | null;
      percentualComissaoIndicacao?: number | null;
    },
    valorBaseMensalidade: number,
  ): number {
    const percentual = Number(vendedor.percentualComissaoIndicacao ?? 0);
    if (percentual > 0) {
      return this.arredondarMoeda((valorBaseMensalidade * percentual) / 100);
    }

    const valorFixo = Number(vendedor.valorComissaoIndicacao ?? 0);
    return this.arredondarMoeda(Math.max(0, valorFixo));
  }

  private async obterPrimeiraMensalidadeElegivel(
    tx: any,
    titularId: number,
  ): Promise<{ dataReferencia: Date; valor: number } | null> {
    const recebimentos = await tx.contaReceber.findMany({
      where: {
        clienteId: titularId,
        status: { in: [...STATUS_RECEBIMENTO_COMISSAO] },
      },
      select: {
        id: true,
        valor: true,
        dataRecebimento: true,
        dataVencimento: true,
        vencimento: true,
      },
      orderBy: [
        { dataRecebimento: 'asc' },
        { dataVencimento: 'asc' },
        { vencimento: 'asc' },
        { id: 'asc' },
      ],
    });

    // Regra de negócio: 1º recebimento = adesão; 2º recebimento = 1ª mensalidade.
    if (recebimentos.length < 2) return null;

    const primeiraMensalidade = recebimentos[1];
    const dataReferencia =
      primeiraMensalidade.dataRecebimento ??
      primeiraMensalidade.dataVencimento ??
      primeiraMensalidade.vencimento;

    return {
      dataReferencia,
      valor: Number(primeiraMensalidade.valor ?? 0),
    };
  }

  private async gerarComissaoPrimeiroPagamentoTx(tx: any, titularId: number) {
    const titular = await tx.titular.findUnique({
      where: { id: titularId },
      select: {
        id: true,
        nome: true,
        vendedorId: true,
        vendedor: {
          select: {
            id: true,
            nome: true,
            valorComissaoIndicacao: true,
            percentualComissaoIndicacao: true,
          },
        },
      },
    });

    if (!titular?.vendedorId || !titular.vendedor) return;
    const possuiConfigComissao =
      (titular.vendedor.valorComissaoIndicacao ?? 0) > 0 ||
      (titular.vendedor.percentualComissaoIndicacao ?? 0) > 0;
    if (!possuiConfigComissao) return;

    const jaTemComissao = await tx.comissao.findFirst({
      where: { titularId: titular.id },
      select: { id: true },
    });
    if (jaTemComissao) return;

    const primeiraMensalidade = await this.obterPrimeiraMensalidadeElegivel(tx, titular.id);
    if (!primeiraMensalidade) return;

    const valorComissao = this.calcularValorComissao(
      titular.vendedor,
      primeiraMensalidade.valor,
    );
    if (valorComissao <= 0) return;

    const vencimentoComissao = this.adicionarAtrasoComissao(
      primeiraMensalidade.dataReferencia,
    );

    const contaPagar = await tx.contaPagar.create({
      data: {
        descricao: `Comissão de indicação do titular #${titular.id} - ${titular.nome}`,
        valor: valorComissao,
        vencimento: vencimentoComissao,
        fornecedor: titular.vendedor.nome,
        status: 'PENDENTE',
      },
    });

    await tx.comissao.create({
      data: {
        vendedorId: titular.vendedor.id,
        titularId: titular.id,
        valor: valorComissao,
        dataGeracao: new Date(),
        statusPagamento: 'PENDENTE',
        contaPagarId: contaPagar.id,
      },
    });
  }

  async ensureCustomerForTitular(titularId: number): Promise<string | null> {
    if (!this.isEnabled()) return null;

    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: {
        id: true,
        nome: true,
        email: true,
        telefone: true,
        cpf: true,
        cep: true,
        logradouro: true,
        numero: true,
        complemento: true,
        bairro: true,
        cidade: true,
        uf: true,
        asaasCustomerId: true,
      },
    });

    if (!titular) {
      throw new Error('Titular não encontrado para integrar com Asaas');
    }

    if (titular.asaasCustomerId) return titular.asaasCustomerId;

    const externalReference = `titular-${titular.id}`;
    const cpfCnpj = this.sanitizeCpfCnpj(titular.cpf);
    const email = this.sanitizeEmail(titular.email);
    const existingCustomerId = await this.findExistingCustomerOnAsaas({
      externalReference,
      cpfCnpj,
      email,
    });

    if (existingCustomerId) {
      await this.persistAsaasCustomerIdSafely(titularId, existingCustomerId);
      this.logger.info('Cliente Asaas reaproveitado por busca', {
        tenantId: this.tenantId,
        titularId,
        customerId: existingCustomerId,
        externalReference,
      });
      return existingCustomerId;
    }

    const payload = {
      name: titular.nome?.trim() || `Titular ${titular.id}`,
      email,
      cpfCnpj,
      phone: this.sanitizePhone(titular.telefone),
      mobilePhone: this.sanitizePhone(titular.telefone),
      postalCode: this.sanitizePostalCode(titular.cep),
      address: titular.logradouro ?? undefined,
      addressNumber: titular.numero ?? undefined,
      complement: titular.complemento ?? undefined,
      province: titular.bairro ?? undefined,
      city: titular.cidade ?? undefined,
      state: this.sanitizeState(titular.uf),
      externalReference,
    };

    let result: any = null;
    try {
      result = await this.client!.createCustomer(payload);
    } catch (error: any) {
      if (error?.status === 400) {
        this.logger.warn('Falha ao criar cliente Asaas com payload completo; tentando payload mínimo', {
          tenantId: this.tenantId,
          titularId,
          externalReference,
          asaasStatus: error?.status,
          asaasBody: error?.body,
        });

        const minimalPayload = {
          name: payload.name,
          email: payload.email,
          externalReference,
        };
        result = await this.client!.createCustomer(minimalPayload);
      } else {
        throw error;
      }
    }
    const customerId = result?.id;

    if (customerId) {
      await this.persistAsaasCustomerIdSafely(titularId, customerId);
    }

    this.logger.info('Customer synchronized with Asaas', {
      tenantId: this.tenantId,
      titularId,
      customerId,
    });

    return customerId ?? null;
  }

  /**
   * O customer já existe no Asaas neste ponto. Não propagamos uma falha local
   * para não cancelar uma cobrança/assinatura válida no provedor; o vínculo
   * será refeito nas próximas tentativas de sincronização.
   */
  private async persistAsaasCustomerIdSafely(titularId: number, customerId: string): Promise<void> {
    try {
      await this.prisma.titular.update({
        where: { id: titularId },
        data: { asaasCustomerId: customerId },
      });
    } catch (error: any) {
      this.logger.warn('Falha ao persistir customer Asaas localmente; seguindo com o customer do provedor', {
        tenantId: this.tenantId,
        titularId,
        customerId,
        error: error?.message,
      });
    }
  }

  async ensurePaymentForContaReceber(
    contaReceberId: number,
    opts?: { billingType?: AsaasPaymentPayload['billingType']; force?: boolean },
  ): Promise<ContaReceberWithCliente | null> {
    if (!this.isEnabled()) return null;

    const conta = await this.prisma.contaReceber.findUnique({
      where: { id: contaReceberId },
      include: { cliente: true },
    });
    if (!conta) {
      throw new Error('Conta a receber não encontrada para integração com Asaas');
    }

    if (conta.asaasPaymentId && !opts?.force) {
      return conta as ContaReceberWithCliente;
    }

    if (!conta.cliente) {
      this.logger.warn('Conta a receber sem cliente; ignorando criação no Asaas', {
        contaReceberId,
      });
      return conta as ContaReceberWithCliente;
    }

    const customerId =
      conta.cliente.asaasCustomerId ||
      (await this.ensureCustomerForTitular(conta.cliente.id)) ||
      undefined;

    if (!customerId) {
      this.logger.warn('Não foi possível resolver customerId no Asaas; integração pulada', {
        contaReceberId,
        titularId: conta.cliente.id,
      });
      return conta as ContaReceberWithCliente;
    }

    const dueDate = new Date(conta.dataVencimento ?? conta.vencimento);
    const payload: AsaasPaymentPayload = {
      customer: customerId,
      billingType: opts?.billingType ?? 'PIX',
      value: conta.valor ?? 0,
      dueDate: dueDate.toISOString().slice(0, 10),
      description: conta.descricao ?? `Conta Receber #${conta.id}`,
      externalReference: `conta-receber-${conta.id}`,
      subscription: conta.asaasSubscriptionId ?? undefined,
    };

    const created = await this.client!.createPayment(payload);
    const pixExpiration = created?.pixExpirationDate
      ? new Date(created.pixExpirationDate)
      : null;
    const dueDateFromProvider = created?.dueDate ? new Date(created.dueDate) : dueDate;
    const paymentUrl =
      (created as any)?.invoiceUrl ||
      (created as any)?.bankSlipUrl ||
      (created as any)?.paymentLink ||
      conta.paymentUrl;

    const updated = await this.prisma.contaReceber.update({
      where: { id: conta.id },
      data: {
        asaasPaymentId: created?.id ?? conta.asaasPaymentId,
        asaasSubscriptionId: created?.subscription ?? payload.subscription ?? conta.asaasSubscriptionId,
        paymentUrl,
        pixQrCode: created?.pixQrCode ?? conta.pixQrCode,
        pixExpiration: pixExpiration ?? conta.pixExpiration,
        metodoPagamento: payload.billingType ?? conta.metodoPagamento,
        dataVencimento: dueDateFromProvider ?? conta.dataVencimento,
      },
      include: { cliente: true },
    });

    this.logger.info('Conta a receber sincronizada com Asaas', {
      contaReceberId,
      tenantId: this.tenantId,
      asaasPaymentId: updated.asaasPaymentId,
      billingType: payload.billingType,
    });

    return updated as ContaReceberWithCliente;
  }

  async updatePaymentForContaReceber(
    contaReceberId: number,
    data: Partial<AsaasPaymentPayload>
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const conta = await this.prisma.contaReceber.findUnique({
      where: { id: contaReceberId },
    });

    if (!conta?.asaasPaymentId) return;

    try {
      await this.client!.updatePayment(conta.asaasPaymentId, data);
      this.logger.info('Pagamento atualizado no Asaas', {
        contaReceberId,
        asaasPaymentId: conta.asaasPaymentId,
        updates: data,
      });
    } catch (error: any) {
      this.logger.warn('Falha ao atualizar pagamento no Asaas', {
        contaReceberId,
        asaasPaymentId: conta.asaasPaymentId,
        error: error?.message,
      });
      // Non-blocking error for local update, but logged
    }
  }

  async deletePaymentForContaReceber(contaReceberId: number): Promise<void> {
    if (!this.isEnabled()) return;

    const conta = await this.prisma.contaReceber.findUnique({
      where: { id: contaReceberId },
    });

    if (!conta?.asaasPaymentId) return;

    try {
      await this.client!.deletePayment(conta.asaasPaymentId);
      this.logger.info('Pagamento removido do Asaas', {
        contaReceberId,
        asaasPaymentId: conta.asaasPaymentId,
      });
    } catch (error: any) {
      this.logger.warn('Falha ao remover pagamento do Asaas', {
        contaReceberId,
        asaasPaymentId: conta.asaasPaymentId,
        error: error?.message,
      });
    }
  }

  async confirmPaymentForContaReceber(contaReceberId: number): Promise<void> {
    if (!this.isEnabled()) return;

    const conta = await this.prisma.contaReceber.findUnique({
      where: { id: contaReceberId },
    });

    if (!conta?.asaasPaymentId) return;

    try {
      const payment = await this.client!.getPaymentById(conta.asaasPaymentId);
      const providerStatus = String(payment?.status ?? '').toUpperCase();
      if (this.isStatusPagamentoRecebidoNoAsaas(providerStatus)) {
        this.logger.info('Baixa no Asaas já estava confirmada', {
          contaReceberId,
          asaasPaymentId: conta.asaasPaymentId,
          providerStatus,
        });
        return;
      }
    } catch (error: any) {
      this.logger.warn('Não foi possível consultar pagamento no Asaas antes da baixa', {
        contaReceberId,
        asaasPaymentId: conta.asaasPaymentId,
        error: error?.message,
      });
    }

    try {
      await this.client!.confirmCashReceipt(conta.asaasPaymentId, {
        paymentDate: new Date().toISOString().slice(0, 10),
        value: Number(conta.valor ?? 0),
        notifyCustomer: false,
      });
    } catch (error: any) {
      if (!this.isErroCobrancaAsaasNaoPendente(error)) throw error;

      const payment = await this.client!.getPaymentById(conta.asaasPaymentId);
      const providerStatus = String(payment?.status ?? '').toUpperCase();
      if (!this.isStatusPagamentoRecebidoNoAsaas(providerStatus)) {
        this.logger.warn('Cobrança Asaas não está pendente, mas também não consta recebida', {
          contaReceberId,
          asaasPaymentId: conta.asaasPaymentId,
          providerStatus,
        });
        throw error;
      }

      this.logger.info('Baixa no Asaas tratada como idempotente', {
        contaReceberId,
        asaasPaymentId: conta.asaasPaymentId,
        providerStatus,
      });
      return;
    }

    this.logger.info('Baixa confirmada no Asaas', {
      contaReceberId,
      asaasPaymentId: conta.asaasPaymentId,
    });
  }

  async revertPaymentForContaReceber(contaReceberId: number): Promise<void> {
    if (!this.isEnabled()) return;

    const conta = await this.prisma.contaReceber.findUnique({
      where: { id: contaReceberId },
    });

    if (!conta?.asaasPaymentId) return;

    const status = String(conta.status ?? '').toUpperCase();
    if (status === 'RECEBIDO' || status === 'PAGO' || status === 'CONFIRMADO') {
      await this.client!.undoCashReceipt(conta.asaasPaymentId);
      this.logger.info('Baixa desfeita no Asaas', {
        contaReceberId,
        asaasPaymentId: conta.asaasPaymentId,
      });
      return;
    }

    await this.client!.deletePayment(conta.asaasPaymentId);
    this.logger.info('Cobrança removida no Asaas em estorno local', {
      contaReceberId,
      asaasPaymentId: conta.asaasPaymentId,
    });
  }

  async ensureMonthlySubscriptionForTitular(args: {
    titularId: number;
    valorMensal: number;
    descricao: string;
    billingType?: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
    proximoVencimento?: Date;
    creditCard?: CreditCardSubscriptionInput;
  }): Promise<string | null> {
    if (!this.isEnabled()) return null;

    const valorMensal = this.arredondarMoeda(Number(args.valorMensal ?? 0));
    if (!Number.isFinite(valorMensal) || valorMensal <= 0) {
      return null;
    }

    const clienteAsaasId = await this.ensureCustomerForTitular(args.titularId);
    if (!clienteAsaasId) return null;

    const referenciaExistente = await this.prisma.contaReceber.findFirst({
      where: {
        clienteId: args.titularId,
        asaasSubscriptionId: { not: null },
      },
      orderBy: { id: 'desc' },
      select: { asaasSubscriptionId: true, descricao: true, metodoPagamento: true },
    });

    const baseDueDate =
      args.proximoVencimento ??
      (referenciaExistente?.asaasSubscriptionId
        ? new Date()
        : this.adicionarMesesPreservandoDia(new Date(), 1));
    const dueDate = new Date(baseDueDate);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate.getTime() <= Date.now()) {
      dueDate.setDate(dueDate.getDate() + 1);
    }

    const billingType =
      args.billingType ??
      (referenciaExistente?.metodoPagamento as 'PIX' | 'BOLETO' | 'CREDIT_CARD' | null) ??
      'PIX';
    const creditCardToken =
      billingType === 'CREDIT_CARD'
        ? await this.resolveCreditCardToken(args.titularId, clienteAsaasId, args.creditCard)
        : null;
    if (billingType === 'CREDIT_CARD' && !creditCardToken) {
      throw new Error('Token de cartao indisponivel para criar recorrencia no Asaas');
    }

    if (referenciaExistente?.asaasSubscriptionId) {
      const subscriptionId = referenciaExistente.asaasSubscriptionId;
      if (billingType === 'CREDIT_CARD' && args.creditCard) {
        await this.client!.updateSubscriptionCreditCard(subscriptionId, {
          creditCard: {
            holderName: args.creditCard.card.holderName,
            number: this.sanitizeDigits(args.creditCard.card.number) || '',
            expiryMonth: this.sanitizeDigits(args.creditCard.card.expiryMonth) || '',
            expiryYear: this.sanitizeDigits(args.creditCard.card.expiryYear) || '',
            ccv: this.sanitizeDigits(args.creditCard.card.ccv) || '',
          },
          creditCardHolderInfo: args.creditCard.holderInfo,
        });
      }
      await this.client!.createOrUpdateSubscription(
        {
          customer: clienteAsaasId,
          billingType,
          value: valorMensal,
          nextDueDate: dueDate.toISOString().slice(0, 10),
          description: args.descricao || referenciaExistente.descricao || undefined,
          cycle: 'MONTHLY',
          externalReference: `titular-${args.titularId}`,
          ...(creditCardToken ? { creditCardToken, remoteIp: args.creditCard?.remoteIp } : {}),
        },
        subscriptionId,
      );

      this.logger.info('Recorrência existente atualizada no Asaas', {
        tenantId: this.tenantId,
        titularId: args.titularId,
        asaasSubscriptionId: subscriptionId,
        valorMensal,
      });

      return subscriptionId;
    }

    const subscription = await this.client!.createOrUpdateSubscription({
      customer: clienteAsaasId,
      billingType,
      value: valorMensal,
      nextDueDate: dueDate.toISOString().slice(0, 10),
      description: args.descricao,
      cycle: 'MONTHLY',
      externalReference: `titular-${args.titularId}`,
      ...(creditCardToken ? { creditCardToken, remoteIp: args.creditCard?.remoteIp } : {}),
    });

    const subscriptionId = (subscription?.id as string | undefined) ?? null;
    if (!subscriptionId) {
      return null;
    }

    await this.syncRecurringPaymentsFromProvider({ maxPages: 2, onlyOpen: true });

    const contaComPayment = await this.prisma.contaReceber.findFirst({
      where: {
        clienteId: args.titularId,
        asaasSubscriptionId: subscriptionId,
      },
      orderBy: { id: 'desc' },
      select: { id: true },
    });

    if (!contaComPayment) {
      await this.prisma.contaReceber.create({
        data: {
          clienteId: args.titularId,
          descricao: args.descricao,
          valor: valorMensal,
          vencimento: dueDate,
          dataVencimento: dueDate,
          status: 'PENDENTE',
          asaasSubscriptionId: subscriptionId,
          metodoPagamento: billingType,
        },
      });
    }

    return subscriptionId;
  }

  private async resolveCreditCardToken(
    titularId: number,
    customerId: string,
    creditCard?: CreditCardSubscriptionInput,
  ): Promise<string | null> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: {
        asaasCardTokenEncrypted: true,
      },
    });

    if (titular?.asaasCardTokenEncrypted) {
      try {
        return decryptText(titular.asaasCardTokenEncrypted);
      } catch (error: any) {
        this.logger.warn('Falha ao descriptografar token de cartao salvo; novo token sera gerado', {
          titularId,
          reason: error?.message,
        });
      }
    }

    if (!creditCard) {
      return null;
    }

    const payload: AsaasCreditCardTokenizePayload = {
      customer: customerId,
      creditCard: {
        holderName: creditCard.card.holderName,
        number: this.sanitizeDigits(creditCard.card.number) || '',
        expiryMonth: this.sanitizeDigits(creditCard.card.expiryMonth) || '',
        expiryYear: this.normalizeExpiryYear(creditCard.card.expiryYear),
        ccv: this.sanitizeDigits(creditCard.card.ccv) || '',
      },
      creditCardHolderInfo: creditCard.holderInfo,
      remoteIp: creditCard.remoteIp,
    };

    const response = await this.client!.tokenizeCreditCard(payload);
    const token = String(response?.creditCardToken ?? response?.token ?? '').trim();
    if (!token) {
      throw new Error('Asaas nao retornou token de cartao');
    }

    await this.prisma.titular.update({
      where: { id: titularId },
      data: {
        asaasCardTokenEncrypted: encryptText(token),
        asaasCardLast4: payload.creditCard.number.slice(-4),
        asaasCardBrand: this.detectCardBrand(payload.creditCard.number),
        asaasCardHolderName: payload.creditCard.holderName,
        asaasCardTokenizedAt: new Date(),
      },
    });

    return token;
  }

  private detectCardBrand(cardNumber: string): string {
    const digits = this.sanitizeDigits(cardNumber) || '';
    if (/^4/.test(digits)) return 'VISA';
    if (/^(5[1-5]|2[2-7])/.test(digits)) return 'MASTERCARD';
    if (/^3[47]/.test(digits)) return 'AMEX';
    if (/^6(?:011|5)/.test(digits)) return 'DISCOVER';
    if (/^(636368|438935|504175|451416|636297)/.test(digits)) return 'ELO';
    if (/^(606282|3841)/.test(digits)) return 'HIPERCARD';
    return 'UNKNOWN';
  }

  private normalizeExpiryYear(value: string): string {
    const digits = this.sanitizeDigits(value) || '';
    if (digits.length === 2) return `20${digits}`;
    return digits;
  }

  async listSubscriptionsFromProvider(maxPages = 10): Promise<any[]> {
    if (!this.isEnabled()) return [];

    const limit = 100;
    let offset = 0;
    let page = 0;
    const result: any[] = [];

    while (page < Math.max(1, Math.min(maxPages, 20))) {
      const response = await this.client!.getSubscriptions({ limit, offset });
      const data = Array.isArray(response?.data) ? response.data : [];
      if (!data.length) break;
      result.push(...data);
      if (data.length < limit) break;
      offset += limit;
      page += 1;
    }

    return result;
  }

  async cancelMonthlySubscriptionForTitular(titularId: number): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Integração Asaas desabilitada para o tenant');
    }

    const localRef = await this.prisma.contaReceber.findFirst({
      where: {
        clienteId: titularId,
        asaasSubscriptionId: { not: null },
      },
      orderBy: { id: 'desc' },
      select: { asaasSubscriptionId: true },
    });

    let subscriptionId = localRef?.asaasSubscriptionId ?? null;

    if (!subscriptionId) {
      const providerList = await this.client!.getSubscriptions({
        externalReference: `titular-${titularId}`,
        limit: 1,
        offset: 0,
      });
      subscriptionId = (providerList?.data?.[0]?.id as string | undefined) ?? null;
    }

    if (!subscriptionId) {
      throw new Error('Titular sem recorrência ativa no Asaas');
    }

    await this.client!.deleteSubscription(subscriptionId);

    await this.prisma.contaReceber.updateMany({
      where: {
        clienteId: titularId,
        asaasSubscriptionId: subscriptionId,
      },
      data: {
        asaasSubscriptionId: null,
      },
    });

    this.logger.info('Recorrência cancelada no Asaas', {
      tenantId: this.tenantId,
      titularId,
      asaasSubscriptionId: subscriptionId,
    });

    return subscriptionId;
  }

  async listPaymentsFromProvider(params?: {
    status?: string;
    customerId?: string;
    externalReference?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: any[]; totalCount?: number; limit?: number; offset?: number }> {
    if (!this.isEnabled()) {
      return { data: [] };
    }

    const page = Math.max(1, Number(params?.page ?? 1));
    const pageSize = Math.max(1, Math.min(Number(params?.pageSize ?? 50), 100));
    const offset = (page - 1) * pageSize;

    const response = await this.client!.getPayments({
      status: params?.status ? String(params.status).toUpperCase() : undefined,
      customer: params?.customerId,
      externalReference: params?.externalReference,
      limit: pageSize,
      offset,
    });

    return {
      data: Array.isArray(response?.data) ? response.data : [],
      totalCount: response?.totalCount,
      limit: response?.limit,
      offset: response?.offset,
    };
  }

  async syncRecurringPaymentsForTitular(
    titularId: number,
    opts?: { maxPages?: number },
  ): Promise<{ processed: number; inserted: number; updated: number }> {
    if (!this.isEnabled()) {
      return { processed: 0, inserted: 0, updated: 0 };
    }

    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: { asaasCustomerId: true },
    });
    const customerId = titular?.asaasCustomerId ?? null;
    if (!customerId) {
      return { processed: 0, inserted: 0, updated: 0 };
    }

    const maxPages = Math.max(1, Math.min(opts?.maxPages ?? 5, 20));
    const limit = 100;
    let processed = 0;
    let inserted = 0;
    let updated = 0;

    const subscriptionIds = new Set<string>();
    const localSubs = await this.prisma.contaReceber.findMany({
      where: {
        clienteId: titularId,
        asaasSubscriptionId: { not: null },
      },
      select: { asaasSubscriptionId: true },
    });
    for (const s of localSubs) {
      if (s.asaasSubscriptionId) subscriptionIds.add(s.asaasSubscriptionId);
    }

    const subscriptionStatuses: Array<'ACTIVE' | 'EXPIRED' | 'INACTIVE'> = [
      'ACTIVE',
      'EXPIRED',
      'INACTIVE',
    ];

    for (const status of subscriptionStatuses) {
      let offset = 0;
      let page = 0;
      while (page < maxPages) {
        const response = await this.client!.getSubscriptions({
          customer: customerId,
          status,
          limit,
          offset,
        });
        const items = Array.isArray(response?.data) ? response.data : [];
        if (!items.length) break;

        for (const sub of items) {
          const subId = typeof sub?.id === 'string' ? sub.id : null;
          if (subId) subscriptionIds.add(subId);
        }

        if (items.length < limit) break;
        offset += limit;
        page += 1;
      }
    }

    for (const subscriptionId of subscriptionIds) {
      const response = await this.client!.getSubscriptionPayments(subscriptionId);
      const items = Array.isArray(response)
        ? response
        : Array.isArray(response?.data)
          ? response.data
          : [];

      for (const payment of items) {
        const paymentId = payment?.id as string | undefined;
        const existed = paymentId
          ? await this.prisma.contaReceber.findUnique({
              where: { asaasPaymentId: paymentId },
              select: { id: true },
            })
          : null;

        const providerStatus = String(payment?.status ?? 'PENDING');
        const customer =
          typeof payment?.customer === 'string'
            ? { id: payment.customer as string }
            : ((payment?.customer as { id?: string } | undefined) ?? { id: customerId });

        const result = await this.handleWebhook({
          event: this.mapEventFromStatus(providerStatus),
          dateCreated: new Date().toISOString(),
          payment: {
            id: payment?.id as string,
            status: providerStatus,
            dueDate: payment?.dueDate as string | undefined,
            value: Number(payment?.value ?? 0),
            description: (payment?.description as string | undefined) ?? undefined,
            invoiceUrl:
              (payment?.invoiceUrl as string | undefined) ??
              (payment?.bankSlipUrl as string | undefined) ??
              (payment?.paymentLink as string | undefined),
            pixQrCode:
              (payment?.pixQrCode as string | undefined) ??
              (payment?.pixQrCodeUrl as string | undefined),
            pixExpirationDate: payment?.pixExpirationDate as string | undefined,
            customer,
            subscription: subscriptionId,
            billingType: payment?.billingType as string | undefined,
          } as any,
          customer,
          subscription: { id: subscriptionId } as any,
        } as AsaasWebhookEvent);

        processed += 1;
        if (!existed && result.contaReceberId) inserted += 1;
        if (existed || (!result.contaReceberId && result.status)) updated += 1;
      }
    }

    this.logger.info('Sincronização de recorrências por titular concluída', {
      tenantId: this.tenantId,
      titularId,
      processed,
      inserted,
      updated,
    });

    return { processed, inserted, updated };
  }

  async syncRecurringPaymentsFromProvider(opts?: { maxPages?: number; onlyOpen?: boolean }) {
    if (!this.isEnabled()) {
      return { processed: 0, inserted: 0, updated: 0 };
    }

    const maxPages = Math.max(1, Math.min(opts?.maxPages ?? 5, 20));
    const limit = 100;
    let offset = 0;
    let page = 0;
    let processed = 0;
    let inserted = 0;
    let updated = 0;

    while (page < maxPages) {
      const response = await this.client!.getPayments({
        limit,
        offset,
      });
      const items = Array.isArray(response?.data) ? response.data : [];
      if (!items.length) break;

      for (const payment of items) {
        const subscriptionId = payment?.subscription as string | undefined;
        if (!subscriptionId) continue;

        const providerStatus = String(payment?.status ?? '').toUpperCase();
        const isClosedStatus =
          providerStatus === 'RECEIVED' ||
          providerStatus === 'RECEIVED_IN_CASH' ||
          providerStatus === 'CONFIRMED' ||
          providerStatus === 'REFUNDED' ||
          providerStatus === 'CANCELLED' ||
          providerStatus === 'CANCELED' ||
          providerStatus === 'DELETED';

        if (opts?.onlyOpen && isClosedStatus) continue;

        const paymentId = payment?.id as string | undefined;
        const existed = paymentId
          ? await this.prisma.contaReceber.findUnique({
              where: { asaasPaymentId: paymentId },
              select: { id: true },
            })
          : null;

        const customer =
          typeof payment?.customer === 'string'
            ? { id: payment.customer as string }
            : ((payment?.customer as { id?: string } | undefined) ?? undefined);

        const result = await this.handleWebhook({
          event: this.mapEventFromStatus(String(payment?.status ?? 'PENDING')),
          dateCreated: new Date().toISOString(),
          payment: {
            id: payment?.id as string,
            status: String(payment?.status ?? 'PENDING'),
            dueDate: payment?.dueDate as string | undefined,
            value: Number(payment?.value ?? 0),
            description: (payment?.description as string | undefined) ?? undefined,
            invoiceUrl:
              (payment?.invoiceUrl as string | undefined) ??
              (payment?.bankSlipUrl as string | undefined) ??
              (payment?.paymentLink as string | undefined),
            bankSlipUrl: (payment?.bankSlipUrl as string | undefined) ?? undefined,
            pixQrCode:
              (payment?.pixQrCode as string | undefined) ??
              (payment?.pixQrCodeId as string | undefined),
            pixExpirationDate: (payment?.pixExpirationDate as string | undefined) ?? undefined,
            subscription: subscriptionId,
            billingType: (payment?.billingType as string | undefined) ?? 'PIX',
            customer,
          },
          subscription: {
            id: subscriptionId,
            status: String(payment?.status ?? 'PENDING'),
            nextDueDate: (payment?.nextDueDate as string | undefined) ?? undefined,
            value: Number(payment?.value ?? 0),
          },
          customer,
        } as AsaasWebhookEvent);

        processed += 1;
        if (!existed && result.contaReceberId) inserted += 1;
        if (existed || (!result.contaReceberId && isClosedStatus)) updated += 1;
      }

      if (items.length < limit) break;
      offset += limit;
      page += 1;
    }

    this.logger.info('Sincronização recorrente Asaas concluída', {
      tenantId: this.tenantId,
      processed,
      inserted,
      updated,
    });

    return { processed, inserted, updated };
  }

  async refreshPaymentStatus(contaReceberId: number): Promise<ContaReceberWithCliente> {
    if (!this.isEnabled()) {
      throw new Error('Integração Asaas desabilitada para o tenant');
    }

    const conta = await this.prisma.contaReceber.findUnique({
      where: { id: contaReceberId },
      include: { cliente: true },
    });

    if (!conta) {
      throw new Error('Conta a receber não encontrada para reconsulta Asaas');
    }

    const externalReference = `conta-receber-${conta.id}`;
    let payment: any = null;

    try {
      if (conta.asaasPaymentId) {
        payment = await this.client!.getPaymentById(conta.asaasPaymentId);
      }
    } catch (error: any) {
      this.logger.warn('Falha ao consultar pagamento por ID no Asaas', {
        tenantId: this.tenantId,
        contaReceberId,
        asaasPaymentId: conta.asaasPaymentId,
        error: error?.message,
      });
    }

    if (!payment) {
      const list = await this.client!.getPayments({
        subscription: conta.asaasSubscriptionId ?? undefined,
        externalReference,
        limit: 1,
      });
      payment = list?.data?.[0];
    }

    if (!payment) {
      this.logger.warn('Reconsulta Asaas sem resultados', {
        tenantId: this.tenantId,
        contaReceberId,
        asaasPaymentId: conta.asaasPaymentId,
        asaasSubscriptionId: conta.asaasSubscriptionId,
      });
      throw new Error('Nenhuma cobrança encontrada no Asaas para esta conta');
    }

    const paymentId = payment.id as string | undefined;
    const subscriptionId = payment.subscription as string | undefined;

    if (!paymentId) {
      throw new Error('Pagamento retornado pelo Asaas sem identificador');
    }

    if (paymentId && paymentId !== conta.asaasPaymentId) {
      await this.prisma.contaReceber.update({
        where: { id: conta.id },
        data: {
          asaasPaymentId: paymentId,
          asaasSubscriptionId: subscriptionId ?? conta.asaasSubscriptionId,
        },
      });
    }

    const eventName = this.mapEventFromStatus(payment.status);
    const statusLocal = this.mapStatusFromProvider(payment.status);
    const payload: AsaasWebhookEvent = {
      event: eventName,
      dateCreated: new Date().toISOString(),
      payment: {
        id: paymentId,
        status: payment.status,
        dueDate: payment.dueDate,
        value: payment.value,
        invoiceUrl: payment.invoiceUrl ?? payment.bankSlipUrl ?? payment.paymentLink,
        bankSlipUrl: payment.bankSlipUrl,
        billingType: payment.billingType,
        pixQrCode: payment.pixQrCode ?? payment.pixQrCodeId,
        pixExpirationDate: payment.pixExpirationDate,
        subscription: subscriptionId,
      },
      subscription: subscriptionId
        ? {
            id: subscriptionId,
            status: payment.status,
            nextDueDate: payment.nextDueDate,
            value: payment.value,
          }
        : undefined,
    };

    const result = await this.handleWebhook(payload);

    this.logger.info('Reconsulta Asaas aplicada', {
      tenantId: this.tenantId,
      contaReceberId,
      asaasPaymentId: paymentId,
      asaasSubscriptionId: subscriptionId,
      status: result.status,
      statusProvider: statusLocal,
    });

    const atualizada = await this.prisma.contaReceber.findUnique({
      where: { id: conta.id },
      include: { cliente: true },
    });

    if (!atualizada) {
      throw new Error('Cobrança recorrente liquidada e removida das contas a receber');
    }

    return atualizada as ContaReceberWithCliente;
  }

  async handleWebhook(event: AsaasWebhookEvent) {
    if (!this.isEnabled()) {
      this.logger.warn('Webhook recebido, mas integração Asaas está desativada', {
        tenantId: this.tenantId,
      });
      return { contaReceberId: null, status: 'IGNORADO' };
    }

    const paymentId = event.payment?.id;
    const subscriptionId = event.payment?.subscription ?? event.subscription?.id;
    const status = this.resolveWebhookStatus(event);
    const statusConfirmado = this.isStatusPagamentoConfirmado(status);
    const dueDate = event.payment?.dueDate ? new Date(event.payment.dueDate) : undefined;
    const pixExpiration = event.payment?.pixExpirationDate
      ? new Date(event.payment.pixExpirationDate)
      : undefined;
    const result = await this.prisma.$transaction(async (tx) => {
      let conta: ContaReceberWithCliente | null = null;
      let notificacaoConfirmacao:
        | {
            titularId: number;
            nome: string;
            email?: string | null;
            telefone?: string | null;
            nomeResponsavelFinanceiro?: string | null;
            telefoneResponsavelFinanceiro?: string | null;
            valor?: number | null;
            dataVencimento?: Date | null;
            descricao?: string | null;
            paymentUrl?: string | null;
            paymentId: string;
          }
        | null = null;
      let primeiroPagamentoConfirmado: {
        titularId: number;
        nome: string;
        email?: string | null;
        telefone?: string | null;
        nomeResponsavelFinanceiro?: string | null;
        telefoneResponsavelFinanceiro?: string | null;
        confirmedAt: Date;
      } | null = null;

      if (paymentId) {
        conta = (await tx.contaReceber.findUnique({
          where: { asaasPaymentId: paymentId },
          include: { cliente: true },
        })) as ContaReceberWithCliente | null;
      }

      // Fallback por assinatura apenas quando não há paymentId.
      // Se houver paymentId e ele não existir localmente, devemos criar
      // uma nova conta para não sobrescrever outra cobrança da mesma recorrência.
      if (!conta && subscriptionId && !paymentId) {
        conta = (await tx.contaReceber.findFirst({
          where: { asaasSubscriptionId: subscriptionId },
          include: { cliente: true },
        })) as ContaReceberWithCliente | null;
      }

      if (!conta && paymentId && subscriptionId) {
        const customerId =
          event.customer?.id ||
          (typeof event.payment?.customer === 'string'
            ? event.payment.customer
            : event.payment?.customer?.id);
        const titular = customerId
          ? await tx.titular.findUnique({
              where: { asaasCustomerId: customerId },
              select: { id: true },
            })
          : null;
        if (titular) {
          conta = (await tx.contaReceber.create({
            data: {
              clienteId: titular.id,
              descricao:
                event.payment?.description ??
                `Recorrência Asaas ${subscriptionId.slice(0, 8)}`,
              valor: Number(event.payment?.value ?? 0),
              vencimento: dueDate ?? new Date(),
              dataVencimento: dueDate ?? new Date(),
              status,
              asaasPaymentId: paymentId,
              asaasSubscriptionId: subscriptionId,
              paymentUrl:
                (event.payment as any)?.invoiceUrl ||
                (event.payment as any)?.bankSlipUrl ||
                undefined,
              pixQrCode: event.payment?.pixQrCode,
              pixExpiration: pixExpiration ?? undefined,
              metodoPagamento: event.payment?.billingType ?? 'ASAAS',
            },
            include: { cliente: true },
          })) as ContaReceberWithCliente;
        }
      }

      if (conta) {
        const alreadySameStatus = conta.status === status;
        const estavaConfirmado = this.isStatusPagamentoConfirmado(conta.status);
        const dataRecebimento = statusConfirmado ? new Date() : null;
        const limparDataRecebimento = status === 'CANCELADO';

        const updatedConta = await tx.contaReceber.update({
          where: { id: conta.id },
          data: {
            status,
            dataRecebimento: limparDataRecebimento
              ? null
              : (dataRecebimento ?? conta.dataRecebimento),
            paymentUrl:
              (event.payment as any)?.invoiceUrl ||
              (event.payment as any)?.bankSlipUrl ||
              conta.paymentUrl,
            pixQrCode: event.payment?.pixQrCode ?? conta.pixQrCode,
            pixExpiration: pixExpiration ?? conta.pixExpiration,
            asaasPaymentId: paymentId ?? conta.asaasPaymentId,
            asaasSubscriptionId: subscriptionId ?? conta.asaasSubscriptionId,
            metodoPagamento:
              event.payment?.billingType ??
              conta.metodoPagamento ??
              (event.payment ? 'ASAAS' : undefined),
            dataVencimento: dueDate ?? conta.dataVencimento,
            valor: event.payment?.value ?? conta.valor,
          },
          include: { cliente: true },
        });

        if (statusConfirmado && paymentId && updatedConta.clienteId) {
          await tx.pagamento.upsert({
            where: { asaasPaymentId: paymentId },
            update: {
              status,
              dataPagamento: new Date(),
              valor: updatedConta.valor,
              metodoPagamento: updatedConta.metodoPagamento ?? 'ASAAS',
              asaasPaymentId: paymentId,
              asaasSubscriptionId: subscriptionId ?? undefined,
              paymentUrl: updatedConta.paymentUrl,
              pixQrCode: updatedConta.pixQrCode,
              pixExpiration: updatedConta.pixExpiration,
              dataVencimento: updatedConta.dataVencimento ?? updatedConta.vencimento,
            },
            create: {
              titularId: updatedConta.clienteId,
              status,
              dataPagamento: new Date(),
              valor: updatedConta.valor,
              metodoPagamento: updatedConta.metodoPagamento ?? 'ASAAS',
              asaasPaymentId: paymentId,
              asaasSubscriptionId: subscriptionId ?? undefined,
              paymentUrl: updatedConta.paymentUrl,
              pixQrCode: updatedConta.pixQrCode,
              pixExpiration: updatedConta.pixExpiration,
              dataVencimento: updatedConta.dataVencimento ?? updatedConta.vencimento,
            },
          });
          await this.atualizarStatusContratoAposPagamentoTx(tx, updatedConta.clienteId);
          await this.gerarComissaoPrimeiroPagamentoTx(tx, updatedConta.clienteId);

          if (!estavaConfirmado && updatedConta.cliente && paymentId) {
            const responsavelFinanceiro = await tx.corresponsavel.findFirst({
              where: {
                titularId: updatedConta.clienteId,
              },
              orderBy: {
                id: 'asc',
              },
              select: {
                nome: true,
                telefone: true,
              },
            });

            notificacaoConfirmacao = {
              titularId: updatedConta.clienteId,
              nome: updatedConta.cliente.nome,
              email: updatedConta.cliente.email,
              telefone: updatedConta.cliente.telefone,
              nomeResponsavelFinanceiro: responsavelFinanceiro?.nome,
              telefoneResponsavelFinanceiro: responsavelFinanceiro?.telefone,
              valor: updatedConta.valor,
              dataVencimento: updatedConta.dataVencimento ?? updatedConta.vencimento,
              descricao: updatedConta.descricao,
              paymentUrl: updatedConta.paymentUrl,
              paymentId,
            };

            // Grava timestamp do primeiro pagamento confirmado (carência + liberação de senha)
            const titularAtual = await tx.titular.findUnique({
              where: { id: updatedConta.clienteId },
              select: { pagamentoConfirmadoEm: true },
            });

            if (!titularAtual?.pagamentoConfirmadoEm) {
              const confirmedAt = new Date();
              await tx.titular.update({
                where: { id: updatedConta.clienteId },
                data: { pagamentoConfirmadoEm: confirmedAt },
              });

              // Atualiza carência dos dependentes para o momento do pagamento
              // (antes era a dataContratacao, que precede o pagamento)
              await (tx as any).dependente.updateMany({
                where: { titularId: updatedConta.clienteId },
                data: { carenciaInicioEm: confirmedAt },
              });

              primeiroPagamentoConfirmado = {
                titularId: updatedConta.clienteId,
                nome: updatedConta.cliente.nome,
                email: updatedConta.cliente.email,
                telefone: updatedConta.cliente.telefone,
                nomeResponsavelFinanceiro: responsavelFinanceiro?.nome,
                telefoneResponsavelFinanceiro: responsavelFinanceiro?.telefone,
                confirmedAt,
              };
            }
          }
          // Mantém a conta recorrente no financeiro para histórico completo
          // (faturas pagas também devem aparecer na listagem do cliente).
        } else if (status === 'CANCELADO' && paymentId && updatedConta.clienteId) {
          await tx.pagamento.upsert({
            where: { asaasPaymentId: paymentId },
            update: {
              status,
              valor: updatedConta.valor,
              metodoPagamento: updatedConta.metodoPagamento ?? 'ASAAS',
              asaasPaymentId: paymentId,
              asaasSubscriptionId: subscriptionId ?? undefined,
              paymentUrl: updatedConta.paymentUrl,
              pixQrCode: updatedConta.pixQrCode,
              pixExpiration: updatedConta.pixExpiration,
              dataVencimento: updatedConta.dataVencimento ?? updatedConta.vencimento,
            },
            create: {
              titularId: updatedConta.clienteId,
              status,
              dataPagamento: new Date(),
              valor: updatedConta.valor,
              metodoPagamento: updatedConta.metodoPagamento ?? 'ASAAS',
              asaasPaymentId: paymentId,
              asaasSubscriptionId: subscriptionId ?? undefined,
              paymentUrl: updatedConta.paymentUrl,
              pixQrCode: updatedConta.pixQrCode,
              pixExpiration: updatedConta.pixExpiration,
              dataVencimento: updatedConta.dataVencimento ?? updatedConta.vencimento,
            },
          });
          // Mantém a conta recorrente cancelada para histórico e auditoria.
        } else if (statusConfirmado && !updatedConta.clienteId) {
          this.logger.warn('Pagamento recebido sem titular vinculado', {
            tenantId: this.tenantId,
            contaReceberId: conta.id,
            paymentId,
          });
        }

        this.logger.info('Webhook Asaas aplicado na conta', {
          tenantId: this.tenantId,
          contaReceberId: conta.id,
          status,
          alreadySameStatus,
          paymentId,
          subscriptionId,
        });

        return { contaReceberId: conta.id, status, notificacaoConfirmacao, primeiroPagamentoConfirmado };
      }

      this.logger.warn('Webhook Asaas recebido sem conta vinculada', {
        tenantId: this.tenantId,
        paymentId,
        subscriptionId,
        event: event.event,
      });

      return { contaReceberId: null, status, notificacaoConfirmacao: null, primeiroPagamentoConfirmado: null };
    });

    if (result.notificacaoConfirmacao) {
      try {
        await this.enviarConfirmacaoAssinatura(result.notificacaoConfirmacao);
      } catch (error: any) {
        this.logger.error('Falha ao enviar confirmações automáticas de assinatura', error, {
          tenantId: this.tenantId,
          titularId: result.notificacaoConfirmacao.titularId,
          paymentId: result.notificacaoConfirmacao.paymentId,
        });
      }
    }

    if (result.primeiroPagamentoConfirmado) {
      try {
        await this.enviarLinkCriacaoSenha(result.primeiroPagamentoConfirmado);
      } catch (error: any) {
        this.logger.error('Falha ao enviar link de criação de senha após pagamento', error, {
          tenantId: this.tenantId,
          titularId: result.primeiroPagamentoConfirmado.titularId,
        });
      }

      try {
        await this.agendarNotificacaoContratoObrigatorio(result.primeiroPagamentoConfirmado);
      } catch (error: any) {
        this.logger.error('Falha ao agendar notificação de contrato pendente', error, {
          tenantId: this.tenantId,
          titularId: result.primeiroPagamentoConfirmado.titularId,
        });
      }
    }

    return { contaReceberId: result.contaReceberId, status: result.status };
  }

  private mapEventFromStatus(status: string): string {
    const normalized = (status || '').toUpperCase();
    switch (normalized) {
      case 'RECEBIDO':
      case 'RECEIVED':
      case 'RECEIVED_IN_CASH':
        return 'PAYMENT_RECEIVED';
      case 'CONFIRMADO':
      case 'CONFIRMED':
        return 'PAYMENT_CONFIRMED';
      case 'VENCIDO':
      case 'OVERDUE':
        return 'PAYMENT_OVERDUE';
      case 'CHARGEBACK_REQUESTED':
      case 'CHARGEBACK_DISPUTE':
      case 'AWAITING_CHARGEBACK_REVERSAL':
        return 'PAYMENT_CHARGEBACK_REQUESTED';
      case 'PARTIALLY_REFUNDED':
      case 'REFUND_IN_PROGRESS':
      case 'REFUNDED':
        return 'PAYMENT_REFUNDED';
      case 'CANCELADO':
      case 'CANCELLED':
      case 'CANCELED':
      case 'DELETED':
        return 'PAYMENT_DELETED';
      case 'PENDENTE':
      case 'PENDING':
      default:
        return 'PAYMENT_CREATED';
    }
  }

  private mapStatus(event: string): string {
    switch (event) {
      case 'PAYMENT_RECEIVED':
        return 'RECEBIDO';
      case 'PAYMENT_CONFIRMED':
        return 'CONFIRMADO';
      case 'PAYMENT_OVERDUE':
        return 'VENCIDO';
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_PARTIALLY_REFUNDED':
      case 'PAYMENT_REFUND_IN_PROGRESS':
      case 'PAYMENT_CHARGEBACK_REQUESTED':
      case 'PAYMENT_CHARGEBACK_DISPUTE':
      case 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL':
      case 'PAYMENT_DELETED':
      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_CANCELLED':
      case 'SUBSCRIPTION_CANCELED':
        return 'CANCELADO';
      case 'PAYMENT_DUNNING_RECEIVED':
        return 'RECEBIDO';
      case 'PAYMENT_RESTORED':
        return 'PENDENTE';
      case 'PAYMENT_CREATED':
      case 'PAYMENT_BANK_SLIP_VIEWED':
      case 'PAYMENT_CHECKOUT_VIEWED':
      case 'PAYMENT_DUNNING_REQUESTED':
      case 'PAYMENT_AWAITING_RISK_ANALYSIS':
      default:
        return 'PENDENTE';
    }
  }

  private resolveWebhookStatus(event: AsaasWebhookEvent): string {
    const providerPaymentStatus = String(event.payment?.status ?? '').trim();
    if (providerPaymentStatus) {
      return this.mapStatusFromProvider(providerPaymentStatus);
    }

    const providerSubscriptionStatus = String(event.subscription?.status ?? '').trim();
    if (providerSubscriptionStatus) {
      return this.mapStatusFromProvider(providerSubscriptionStatus);
    }

    return this.mapStatus(event.event);
  }

  async changePaymentMethod(args: {
    titularId: number;
    action: 'ATUALIZAR_CARTAO' | 'TROCAR_METODO';
    novoMetodo?: 'CREDIT_CARD' | 'PIX' | 'BOLETO';
    creditCard?: CreditCardSubscriptionInput;
  }): Promise<{ metodoPagamento: string }> {
    if (!this.isEnabled()) {
      throw new Error('Integração Asaas desabilitada para o tenant');
    }

    const { titularId, action, novoMetodo, creditCard } = args;

    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: {
        asaasCustomerId: true,
        asaasCardTokenEncrypted: true,
        asaasCardLast4: true,
        asaasCardBrand: true,
        asaasCardHolderName: true,
      },
    });

    if (!titular) {
      throw new Error('Titular não encontrado');
    }

    const asaasCustomerId =
      titular.asaasCustomerId ?? await this.ensureCustomerForTitular(titularId);

    if (!asaasCustomerId) {
      throw new Error('Titular sem customer no Asaas');
    }

    const referenciaRecorrente = await this.prisma.contaReceber.findFirst({
      where: {
        clienteId: titularId,
        asaasSubscriptionId: { not: null },
      },
      orderBy: { id: 'desc' },
      select: {
        asaasSubscriptionId: true,
        metodoPagamento: true,
        valor: true,
        descricao: true,
        dataVencimento: true,
        vencimento: true,
      },
    });

    if (!referenciaRecorrente?.asaasSubscriptionId) {
      throw new Error('Titular sem assinatura recorrente no Asaas');
    }

    const subscriptionId = referenciaRecorrente.asaasSubscriptionId;

    const activeRequest = await this.prisma.paymentMethodChangeRequest.findFirst({
      where: { titularId, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (activeRequest) {
      throw new Error('Já existe uma alteração de pagamento em andamento. Aguarde a conclusão.');
    }

    const metodoAtual = referenciaRecorrente.metodoPagamento ?? 'PIX';
    const metodoDestino =
      action === 'ATUALIZAR_CARTAO' ? 'CREDIT_CARD' : (novoMetodo ?? metodoAtual);

    if (action === 'ATUALIZAR_CARTAO' && metodoAtual !== 'CREDIT_CARD') {
      throw new Error('O método atual não é cartão de crédito. Use TROCAR_METODO para migrar.');
    }
    if ((metodoDestino === 'CREDIT_CARD') && !creditCard) {
      throw new Error('Dados do cartão são obrigatórios para pagamento em cartão de crédito.');
    }

    const changeRequest = await this.prisma.paymentMethodChangeRequest.create({
      data: {
        titularId,
        oldMethod: metodoAtual,
        newMethod: metodoDestino,
        oldCardToken: titular.asaasCardTokenEncrypted,
        asaasCustomerId,
        asaasSubscriptionId: subscriptionId,
        status: 'PROCESSING',
        idempotencyKey: `${titularId}-${action}-${Date.now()}`,
      },
    });

    try {
      let newToken: string | null = null;

      if (metodoDestino === 'CREDIT_CARD' && creditCard) {
        const payload: AsaasCreditCardTokenizePayload = {
          customer: asaasCustomerId,
          creditCard: {
            holderName: creditCard.card.holderName,
            number: this.sanitizeDigits(creditCard.card.number) || '',
            expiryMonth: this.sanitizeDigits(creditCard.card.expiryMonth) || '',
            expiryYear: this.normalizeExpiryYear(creditCard.card.expiryYear),
            ccv: this.sanitizeDigits(creditCard.card.ccv) || '',
          },
          creditCardHolderInfo: creditCard.holderInfo,
          remoteIp: creditCard.remoteIp,
        };

        const tokenResponse = await this.client!.tokenizeCreditCard(payload);
        newToken = String(tokenResponse?.creditCardToken ?? tokenResponse?.token ?? '').trim();
        if (!newToken) throw new Error('Asaas não retornou token de cartão');

        await this.client!.updateSubscriptionCreditCard(subscriptionId, {
          creditCard: payload.creditCard,
          creditCardHolderInfo: payload.creditCardHolderInfo,
        });
      }

      // Atualiza billingType da assinatura quando método muda
      if (action === 'TROCAR_METODO') {
        const subscriptionValue = this.arredondarMoeda(Number(referenciaRecorrente.valor ?? 0));
        if (!Number.isFinite(subscriptionValue) || subscriptionValue <= 0) {
          throw new Error('Assinatura recorrente sem valor válido para atualizar no Asaas.');
        }

        const dueDateBase = referenciaRecorrente.dataVencimento ?? referenciaRecorrente.vencimento ?? new Date();
        const nextDueDate = new Date(dueDateBase);
        nextDueDate.setHours(0, 0, 0, 0);
        if (nextDueDate.getTime() <= Date.now()) {
          nextDueDate.setDate(nextDueDate.getDate() + 1);
        }

        await this.client!.createOrUpdateSubscription(
          {
            customer: asaasCustomerId,
            billingType: metodoDestino as any,
            value: subscriptionValue,
            nextDueDate: nextDueDate.toISOString().slice(0, 10),
            description: referenciaRecorrente.descricao ?? undefined,
          },
          subscriptionId,
        );
      }

      await this.prisma.$transaction(async (tx) => {
        const cardUpdateData =
          metodoDestino === 'CREDIT_CARD' && newToken && creditCard
            ? {
                asaasCardTokenEncrypted: encryptText(newToken),
                asaasCardBrand: this.detectCardBrand(creditCard.card.number),
                asaasCardLast4: (this.sanitizeDigits(creditCard.card.number) || '').slice(-4),
                asaasCardHolderName: creditCard.card.holderName,
                asaasCardTokenizedAt: new Date(),
              }
            : metodoDestino !== 'CREDIT_CARD'
              ? {
                  asaasCardTokenEncrypted: null,
                  asaasCardBrand: null,
                  asaasCardLast4: null,
                  asaasCardHolderName: null,
                  asaasCardTokenizedAt: null,
                }
              : {};

        if (Object.keys(cardUpdateData).length > 0) {
          await tx.titular.update({
            where: { id: titularId },
            data: cardUpdateData,
          });
        }

        await tx.contaReceber.updateMany({
          where: {
            clienteId: titularId,
            asaasSubscriptionId: subscriptionId,
            status: 'PENDENTE',
          },
          data: { metodoPagamento: metodoDestino },
        });

        await tx.paymentMethodChangeRequest.update({
          where: { id: changeRequest.id },
          data: { status: 'SUCCESS', newCardToken: newToken },
        });
      });

      this.logger.info('Método de pagamento alterado com sucesso', {
        tenantId: this.tenantId,
        titularId,
        action,
        oldMethod: metodoAtual,
        newMethod: metodoDestino,
      });

      return { metodoPagamento: metodoDestino };
    } catch (error: any) {
      await this.prisma.paymentMethodChangeRequest.update({
        where: { id: changeRequest.id },
        data: { status: 'FAILED', errorMessage: String(error?.message ?? error) },
      });
      throw error;
    }
  }

  private mapStatusFromProvider(status: string): string {
    const normalized = (status || '').toUpperCase();
    switch (normalized) {
      case 'RECEIVED':
      case 'RECEIVED_IN_CASH':
        return 'RECEBIDO';
      case 'CONFIRMED':
        return 'CONFIRMADO';
      case 'OVERDUE':
        return 'VENCIDO';
      case 'CHARGEBACK_REQUESTED':
      case 'CHARGEBACK_DISPUTE':
      case 'AWAITING_CHARGEBACK_REVERSAL':
      case 'PARTIALLY_REFUNDED':
      case 'REFUND_IN_PROGRESS':
      case 'REFUNDED':
      case 'CANCELLED':
      case 'CANCELED':
      case 'DELETED':
        return 'CANCELADO';
      case 'PENDING':
      default:
        return 'PENDENTE';
    }
  }
}
