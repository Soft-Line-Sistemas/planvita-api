import Logger from '../utils/logger';
import {
  AsaasClient,
  AsaasWebhookEvent,
  resolveAsaasCredentials,
  AsaasPaymentPayload,
} from '../utils/asaasClient';
import { getPrismaForTenant, Prisma } from '../utils/prisma';
import { NotificationApiClient } from '../utils/notificationClient';

type ContaReceberWithCliente = Prisma.ContaReceberGetPayload<{
  include: {
    cliente: true;
  };
}>;
const COMISSAO_ADESAO_DELAY_MS =
  process.env.NODE_ENV === 'development'
    ? 60 * 60 * 1000
    : 35 * 24 * 60 * 60 * 1000;
const STATUS_RECEBIMENTO_COMISSAO = ['RECEBIDO', 'CONFIRMADO'] as const;

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

  private isStatusPagamentoConfirmado(status: string): boolean {
    return status === 'RECEBIDO' || status === 'CONFIRMADO';
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
    const [logEmailExistente, logWhatsappExistente] = await Promise.all([
      this.prisma.notificationLog.findFirst({
        where: {
          tenantId: this.tenantId,
          logId: `${logBaseId}:email`,
          status: 'enviado',
        },
        select: { id: true },
      }),
      this.prisma.notificationLog.findFirst({
        where: {
          tenantId: this.tenantId,
          logId: `${logBaseId}:whatsapp`,
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
        const response = await this.notificationClient.send({
          to: payload.email,
          channel: 'email',
          subject: assunto,
          message: mensagemBase,
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

    if (!logWhatsappExistente) {
      const telefoneWhatsapp = this.normalizarTelefoneWhatsapp(payload.telefone);
      if (!telefoneWhatsapp) {
        await this.registrarLogNotificacaoConfirmacao({
          titularId: payload.titularId,
          canal: 'whatsapp',
          status: 'ignorado',
          motivo: 'titular sem WhatsApp para confirmação',
          logId: `${logBaseId}:whatsapp`,
        });
      } else {
        const response = await this.notificationClient.send({
          to: telefoneWhatsapp,
          channel: 'whatsapp',
          message: mensagemBase,
          metadata: {
            flow: 'assinatura-confirmada',
            paymentId: payload.paymentId,
            titularId: payload.titularId,
          },
        });
        await this.registrarLogNotificacaoConfirmacao({
          titularId: payload.titularId,
          destinatario: telefoneWhatsapp,
          canal: 'whatsapp',
          status: response.success ? 'enviado' : 'falha',
          motivo: response.error,
          logId: `${logBaseId}:whatsapp`,
        });
      }
    }
  }

  private arredondarMoeda(valor: number): number {
    return Math.round((valor + Number.EPSILON) * 100) / 100;
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

    const payload = {
      name: titular.nome,
      email: titular.email,
      cpfCnpj: titular.cpf ?? undefined,
      phone: titular.telefone ?? undefined,
      mobilePhone: titular.telefone ?? undefined,
      postalCode: titular.cep ?? undefined,
      address: titular.logradouro ?? undefined,
      addressNumber: titular.numero ?? undefined,
      complement: titular.complemento ?? undefined,
      province: titular.bairro ?? undefined,
      city: titular.cidade ?? undefined,
      state: titular.uf ?? undefined,
      externalReference: `titular-${titular.id}`,
    };

    const result = await this.client!.createCustomer(payload);
    const customerId = result?.id;

    if (customerId) {
      await this.prisma.titular.update({
        where: { id: titularId },
        data: { asaasCustomerId: customerId },
      });
    }

    this.logger.info('Customer synchronized with Asaas', {
      tenantId: this.tenantId,
      titularId,
      customerId,
    });

    return customerId ?? null;
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

  async ensureMonthlySubscriptionForTitular(args: {
    titularId: number;
    valorMensal: number;
    descricao: string;
    billingType?: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
    proximoVencimento?: Date;
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
      select: { asaasSubscriptionId: true },
    });

    if (referenciaExistente?.asaasSubscriptionId) {
      return referenciaExistente.asaasSubscriptionId;
    }

    const baseDueDate = args.proximoVencimento ?? new Date();
    const dueDate = new Date(baseDueDate);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate.getTime() <= Date.now()) {
      dueDate.setDate(dueDate.getDate() + 1);
    }

    const subscription = await this.client!.createOrUpdateSubscription({
      customer: clienteAsaasId,
      billingType: args.billingType ?? 'PIX',
      value: valorMensal,
      nextDueDate: dueDate.toISOString().slice(0, 10),
      description: args.descricao,
      cycle: 'MONTHLY',
      externalReference: `titular-${args.titularId}`,
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
          metodoPagamento: args.billingType ?? 'PIX',
        },
      });
    }

    return subscriptionId;
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
    const status = this.mapStatus(event.event);
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
            valor?: number | null;
            dataVencimento?: Date | null;
            descricao?: string | null;
            paymentUrl?: string | null;
            paymentId: string;
          }
        | null = null;

      if (paymentId) {
        conta = (await tx.contaReceber.findUnique({
          where: { asaasPaymentId: paymentId },
          include: { cliente: true },
        })) as ContaReceberWithCliente | null;
      }

      if (!conta && subscriptionId) {
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
          await tx.titular.updateMany({
            where: {
              id: updatedConta.clienteId,
              statusPlano: {
                not: 'ATIVO',
              },
            },
            data: {
              statusPlano: 'ATIVO',
            },
          });
          await this.gerarComissaoPrimeiroPagamentoTx(tx, updatedConta.clienteId);

          if (!estavaConfirmado && updatedConta.cliente && paymentId) {
            notificacaoConfirmacao = {
              titularId: updatedConta.clienteId,
              nome: updatedConta.cliente.nome,
              email: updatedConta.cliente.email,
              telefone: updatedConta.cliente.telefone,
              valor: updatedConta.valor,
              dataVencimento: updatedConta.dataVencimento ?? updatedConta.vencimento,
              descricao: updatedConta.descricao,
              paymentUrl: updatedConta.paymentUrl,
              paymentId,
            };
          }
          if (updatedConta.asaasSubscriptionId) {
            await tx.contaReceber.delete({
              where: { id: updatedConta.id },
            });
          }
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
          if (updatedConta.asaasSubscriptionId) {
            await tx.contaReceber.delete({
              where: { id: updatedConta.id },
            });
          }
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

        return { contaReceberId: conta.id, status, notificacaoConfirmacao };
      }

      this.logger.warn('Webhook Asaas recebido sem conta vinculada', {
        tenantId: this.tenantId,
        paymentId,
        subscriptionId,
        event: event.event,
      });

      return { contaReceberId: null, status, notificacaoConfirmacao: null };
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

    return { contaReceberId: result.contaReceberId, status: result.status };
  }

  private mapEventFromStatus(status: string): string {
    const normalized = (status || '').toUpperCase();
    switch (normalized) {
      case 'RECEIVED':
        return 'PAYMENT_RECEIVED';
      case 'CONFIRMED':
        return 'PAYMENT_CONFIRMED';
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
      case 'CANCELLED':
      case 'CANCELED':
      case 'DELETED':
        return 'PAYMENT_DELETED';
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
