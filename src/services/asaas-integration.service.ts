import Logger from '../utils/logger';
import {
  AsaasClient,
  AsaasWebhookEvent,
  resolveAsaasCredentials,
  AsaasPaymentPayload,
} from '../utils/asaasClient';
import { getPrismaForTenant, Prisma } from '../utils/prisma';

type ContaReceberWithCliente = Prisma.ContaReceberGetPayload<{
  include: {
    cliente: true;
  };
}>;

export class AsaasIntegrationService {
  private prisma;
  private logger: Logger;
  private client: AsaasClient | null = null;
  private enabled: boolean = false;

  constructor(private tenantId: string, private requestId?: string) {
    this.prisma = getPrismaForTenant(tenantId);
    this.logger = new Logger({
      service: 'AsaasIntegrationService',
      tenantId,
      requestId,
    });

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
          },
        },
      },
    });

    if (!titular?.vendedorId || !titular.vendedor) return;
    if ((titular.vendedor.valorComissaoIndicacao ?? 0) <= 0) return;

    const jaTemComissao = await tx.comissao.findFirst({
      where: { titularId: titular.id },
      select: { id: true },
    });
    if (jaTemComissao) return;

    const contaPagar = await tx.contaPagar.create({
      data: {
        descricao: `Comissão de indicação do titular #${titular.id} - ${titular.nome}`,
        valor: titular.vendedor.valorComissaoIndicacao,
        vencimento: new Date(),
        fornecedor: titular.vendedor.nome,
        status: 'PENDENTE',
      },
    });

    await tx.comissao.create({
      data: {
        vendedorId: titular.vendedor.id,
        titularId: titular.id,
        valor: titular.vendedor.valorComissaoIndicacao,
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
    const dueDate = event.payment?.dueDate ? new Date(event.payment.dueDate) : undefined;
    const pixExpiration = event.payment?.pixExpirationDate
      ? new Date(event.payment.pixExpirationDate)
      : undefined;

    return this.prisma.$transaction(async (tx) => {
      let conta: ContaReceberWithCliente | null = null;

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

      if (conta) {
        const alreadySameStatus = conta.status === status;
        const dataRecebimento = status === 'RECEBIDO' ? new Date() : null;

        const updatedConta = await tx.contaReceber.update({
          where: { id: conta.id },
          data: {
            status,
            dataRecebimento: dataRecebimento ?? conta.dataRecebimento,
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

        if (status === 'RECEBIDO' && paymentId && updatedConta.clienteId) {
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
          await this.gerarComissaoPrimeiroPagamentoTx(tx, updatedConta.clienteId);
        } else if (status === 'RECEBIDO' && !updatedConta.clienteId) {
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

        return { contaReceberId: conta.id, status };
      }

      this.logger.warn('Webhook Asaas recebido sem conta vinculada', {
        tenantId: this.tenantId,
        paymentId,
        subscriptionId,
        event: event.event,
      });

      return { contaReceberId: null, status };
    });
  }

  private mapEventFromStatus(status: string): string {
    const normalized = (status || '').toUpperCase();
    switch (normalized) {
      case 'RECEIVED':
      case 'CONFIRMED':
        return 'PAYMENT_RECEIVED';
      case 'OVERDUE':
        return 'PAYMENT_OVERDUE';
      case 'REFUNDED':
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
      case 'PAYMENT_CONFIRMED':
        return 'RECEBIDO';
      case 'PAYMENT_OVERDUE':
        return 'VENCIDO';
      case 'PAYMENT_DELETED':
      case 'SUBSCRIPTION_DELETED':
      case 'SUBSCRIPTION_CANCELLED':
      case 'SUBSCRIPTION_CANCELED':
        return 'CANCELADO';
      case 'PAYMENT_CREATED':
      default:
        return 'PENDENTE';
    }
  }

  private mapStatusFromProvider(status: string): string {
    const normalized = (status || '').toUpperCase();
    switch (normalized) {
      case 'RECEIVED':
      case 'CONFIRMED':
        return 'RECEBIDO';
      case 'OVERDUE':
        return 'VENCIDO';
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
