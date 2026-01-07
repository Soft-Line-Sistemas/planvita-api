import { getPrismaForTenant, Prisma } from '../utils/prisma';
import { AsaasIntegrationService } from './asaas-integration.service';
import Logger from '../utils/logger';

const RELATORIO_CACHE = new Map<
  string,
  { data: FinanceiroRelatorioDTO; expiresAt: number }
>();
const RECORRENCIA_CACHE = new Map<
  string,
  {
    data: {
      mrr: number;
      revenueOneTime: number;
      churnRate: number;
      activeSubscriptions: number;
      cancelledSubscriptions: number;
    };
    expiresAt: number;
  }
>();
const DEFAULT_CACHE_TTL_MS = Number(process.env.FINANCEIRO_CACHE_TTL_MS || 60000);

type ContaPagarType = Prisma.ContaPagarGetPayload<{}>;
type ContaReceberType = Prisma.ContaReceberGetPayload<{
  include: {
    cliente: {
      select: {
        id: true;
        nome: true;
        email: true;
        telefone: true;
        cpf: true;
      };
    };
  };
}>;

type BancoFinanceiroType = Prisma.BancoFinanceiroGetPayload<{}>;
type TipoContabilFinanceiroType = Prisma.TipoContabilFinanceiroGetPayload<{}>;
type FormaPagamentoFinanceiraType = Prisma.FormaPagamentoFinanceiraGetPayload<{}>;
type CentroResultadoFinanceiroType = Prisma.CentroResultadoFinanceiroGetPayload<{}>;
type PagamentoType = Prisma.PagamentoGetPayload<{
  include: {
    titular: {
      select: {
        id: true;
        nome: true;
      };
    };
  };
}>;
type ComissaoType = Prisma.ComissaoGetPayload<{
  include: {
    vendedor: {
      select: {
        id: true;
        nome: true;
      };
    };
  };
}>;
type ReciboType = Prisma.ReciboGetPayload<{}>;

export type ContaFinanceiraDTO =
  | (ContaPagarType & { tipo: 'Pagar' })
  | (ContaReceberType & { tipo: 'Receber' });

export interface ContaPagarInput {
  descricao: string;
  valor: number;
  vencimento: Date;
  fornecedor?: string;
}

export interface ContaReceberInput {
  descricao: string;
  valor: number;
  vencimento: Date;
  clienteId?: number;
  integrarAsaas?: boolean;
  billingType?: 'PIX' | 'BOLETO' | 'CREDIT_CARD';
}

export interface FinanceiroCatalogosDTO {
  bancos: BancoFinanceiroType[];
  tiposContabeis: TipoContabilFinanceiroType[];
  formasPagamento: FormaPagamentoFinanceiraType[];
  centrosResultado: CentroResultadoFinanceiroType[];
}

export interface BancoFinanceiroInput {
  nome: string;
  agencia?: string;
  conta?: string;
  saldo?: number;
  ativo?: boolean;
}

export interface TipoContabilFinanceiroInput {
  descricao: string;
  natureza?: string;
  ativo?: boolean;
}

export interface FormaPagamentoFinanceiraInput {
  nome: string;
  prazo?: string;
  ativo?: boolean;
}

export interface CentroResultadoFinanceiroInput {
  nome: string;
  descricao?: string;
  orcamento?: number;
  ativo?: boolean;
}

export interface FinanceiroRelatorioDTO {
  totais: {
    entradas: number;
    saidas: number;
    lucro: number;
    margem: number;
  };
  mensal: Array<{
    mes: string;
    entradas: number;
    saidas: number;
  }>;
  distribuicao: Array<{
    nome: string;
    valor: number;
  }>;
  comissoes: Array<{
    nome: string;
    vendas: number;
    comissao: number;
  }>;
  recibos: Array<{
    tipo: string;
    total: number;
  }>;
}

export class FinanceiroService {
  private prisma;
  private asaasIntegration: AsaasIntegrationService;
  private logger: Logger;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
    this.asaasIntegration = new AsaasIntegrationService(tenantId);
    this.logger = new Logger({ service: 'FinanceiroService', tenantId });
  }

  private async logAudit(
    entityType: 'ContaPagar' | 'ContaReceber',
    entityId: number,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    changes?: Record<string, any>,
    performedBy?: number
  ) {
    try {
      await this.prisma.financialAudit.create({
        data: {
          entityType,
          entityId,
          action,
          changes: changes ? JSON.stringify(changes) : null,
          performedBy,
        },
      });
    } catch (error) {
      this.logger.error('Failed to create audit log', error);
    }
  }

  async listarContas(): Promise<ContaFinanceiraDTO[]> {
    const [contasPagar, contasReceber] = await Promise.all([
      this.prisma.contaPagar.findMany(),
      this.prisma.contaReceber.findMany({
        include: {
          cliente: {
            select: {
              id: true,
              nome: true,
          email: true,
          telefone: true,
          cpf: true,
        },
      },
        },
      }),
    ]);

    return [
      ...contasPagar.map((conta) => ({ ...conta, tipo: 'Pagar' as const })),
      ...contasReceber.map((conta) => ({ ...conta, tipo: 'Receber' as const })),
    ];
  }

  async criarContaPagar(data: ContaPagarInput, userId?: number): Promise<ContaFinanceiraDTO> {
    if (data.valor <= 0) {
      throw new Error("O valor deve ser positivo.");
    }
    if (!data.descricao || data.descricao.trim() === "") {
      throw new Error("A descrição é obrigatória.");
    }

    const conta = await this.prisma.contaPagar.create({
      data: {
        descricao: data.descricao,
        valor: data.valor,
        vencimento: data.vencimento,
        fornecedor: data.fornecedor,
        status: 'PENDENTE',
      },
    });
    
    await this.logAudit('ContaPagar', conta.id, 'CREATE', data, userId);
    
    return { ...conta, tipo: 'Pagar' as const };
  }

  async atualizarContaPagar(id: number, data: Partial<ContaPagarInput>, userId?: number): Promise<ContaFinanceiraDTO> {
    const atual = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!atual) throw new Error("Conta não encontrada");
    
    if (data.valor !== undefined && data.valor <= 0) throw new Error("O valor deve ser positivo.");
    if (data.descricao !== undefined && !data.descricao.trim()) throw new Error("A descrição é obrigatória.");

    const conta = await this.prisma.contaPagar.update({
      where: { id },
      data: {
        descricao: data.descricao,
        valor: data.valor,
        vencimento: data.vencimento,
        fornecedor: data.fornecedor,
      },
    });
    
    await this.logAudit('ContaPagar', id, 'UPDATE', data, userId);
    return { ...conta, tipo: 'Pagar' as const };
  }

  async criarContaReceber(data: ContaReceberInput, userId?: number): Promise<ContaFinanceiraDTO> {
    if (data.valor <= 0) {
      throw new Error("O valor deve ser positivo.");
    }
    if (!data.descricao || data.descricao.trim() === "") {
      throw new Error("A descrição é obrigatória.");
    }

    const conta = await this.prisma.contaReceber.create({
      data: {
        descricao: data.descricao,
        valor: data.valor,
        vencimento: data.vencimento,
        clienteId: data.clienteId,
        status: 'PENDENTE',
      },
      include: {
        cliente: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
            cpf: true,
          },
        },
      },
    });

    await this.logAudit('ContaReceber', conta.id, 'CREATE', data, userId);

    let contaSincronizada = conta;

    if (data.integrarAsaas !== false) {
      try {
        const atualizado = await this.asaasIntegration.ensurePaymentForContaReceber(conta.id, {
          billingType: data.billingType,
        });
        contaSincronizada = atualizado ?? conta;
      } catch (error: any) {
        this.logger.warn('Falha ao sincronizar conta a receber com Asaas', {
          error: error?.message,
          contaReceberId: conta.id,
        });
      }
    }

    return { ...contaSincronizada, tipo: 'Receber' as const };
  }

  async atualizarContaReceber(id: number, data: Partial<ContaReceberInput>, userId?: number): Promise<ContaFinanceiraDTO> {
    const atual = await this.prisma.contaReceber.findUnique({ where: { id } });
    if (!atual) throw new Error("Conta não encontrada");
    
    if (data.valor !== undefined && data.valor <= 0) throw new Error("O valor deve ser positivo.");
    if (data.descricao !== undefined && !data.descricao.trim()) throw new Error("A descrição é obrigatória.");

    if (atual.asaasPaymentId && (data.valor || data.vencimento || data.descricao)) {
       await this.asaasIntegration.updatePaymentForContaReceber(id, {
         value: data.valor,
         dueDate: data.vencimento ? new Date(data.vencimento).toISOString().slice(0, 10) : undefined,
         description: data.descricao,
       });
    }

    const conta = await this.prisma.contaReceber.update({
      where: { id },
      data: {
        descricao: data.descricao,
        valor: data.valor,
        vencimento: data.vencimento,
        clienteId: data.clienteId,
      },
      include: {
        cliente: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
            cpf: true,
          },
        },
      },
    });
    
    await this.logAudit('ContaReceber', id, 'UPDATE', data, userId);
    return { ...conta, tipo: 'Receber' as const };
  }

  async deletarContaPagar(id: number, userId?: number): Promise<void> {
    const conta = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!conta) throw new Error("Conta não encontrada");

    await this.prisma.contaPagar.delete({ where: { id } });
    await this.logAudit('ContaPagar', id, 'DELETE', conta, userId);
  }

  async deletarContaReceber(id: number, userId?: number): Promise<void> {
    const conta = await this.prisma.contaReceber.findUnique({ where: { id } });
    if (!conta) throw new Error("Conta não encontrada");

    if (conta.asaasPaymentId) {
      await this.asaasIntegration.deletePaymentForContaReceber(id);
    }

    await this.prisma.contaReceber.delete({ where: { id } });
    await this.logAudit('ContaReceber', id, 'DELETE', conta, userId);
  }

  async baixarConta(
    tipo: 'Pagar' | 'Receber',
    id: number,
    usuarioId?: number,
  ): Promise<ContaFinanceiraDTO> {
    if (tipo === 'Pagar') {
      const conta = await this.prisma.contaPagar.update({
        where: { id },
        data: {
          status: 'PAGO',
          dataPagamento: new Date(),
        },
      });
      await this.logAudit('ContaPagar', id, 'UPDATE', { status: 'PAGO' }, usuarioId);
      return { ...conta, tipo: 'Pagar' as const };
    }

    const contaExistente = await this.prisma.contaReceber.findUnique({ where: { id } });
    if (contaExistente?.asaasPaymentId) {
      this.logger.warn(
        'Baixa manual em cobrança integrada ao Asaas',
        {
          contaReceberId: id,
          tenantId: this.tenantId,
          asaasPaymentId: contaExistente.asaasPaymentId,
          usuarioId,
        },
      );
    }

    const conta = await this.prisma.contaReceber.update({
      where: { id },
      data: {
        status: 'RECEBIDO',
        dataRecebimento: new Date(),
      },
      include: {
        cliente: {
          select: {
            id: true,
            nome: true,
          email: true,
          telefone: true,
          cpf: true,
        },
        },
      },
    });
    this.logger.info('Baixa manual aplicada', {
      contaReceberId: id,
      tenantId: this.tenantId,
      usuarioId,
      asaasPaymentId: contaExistente?.asaasPaymentId,
    });
    
    await this.logAudit('ContaReceber', id, 'UPDATE', { status: 'RECEBIDO' }, usuarioId);
    
    return { ...conta, tipo: 'Receber' as const };
  }

  async estornarConta(
    tipo: 'Pagar' | 'Receber',
    id: number,
    usuarioId?: number,
  ): Promise<ContaFinanceiraDTO> {
    if (tipo === 'Pagar') {
      const conta = await this.prisma.contaPagar.update({
        where: { id },
        data: {
          status: 'CANCELADO',
          dataPagamento: null,
        },
      });
      await this.logAudit('ContaPagar', id, 'UPDATE', { status: 'CANCELADO' }, usuarioId);
      return { ...conta, tipo: 'Pagar' as const };
    }

    const contaExistente = await this.prisma.contaReceber.findUnique({ where: { id } });
    if (contaExistente?.asaasPaymentId) {
      this.logger.warn('Estorno manual em cobrança integrada ao Asaas', {
        contaReceberId: id,
        tenantId: this.tenantId,
        asaasPaymentId: contaExistente.asaasPaymentId,
        usuarioId,
      });
    }

    const conta = await this.prisma.contaReceber.update({
      where: { id },
      data: {
        status: 'CANCELADO',
        dataRecebimento: null,
      },
      include: {
        cliente: {
          select: {
            id: true,
            nome: true,
          email: true,
          telefone: true,
          cpf: true,
        },
        },
      },
    });
    this.logger.info('Estorno aplicado', {
      contaReceberId: id,
      tenantId: this.tenantId,
      usuarioId,
      asaasPaymentId: contaExistente?.asaasPaymentId,
    });
    
    await this.logAudit('ContaReceber', id, 'UPDATE', { status: 'PENDENTE' }, usuarioId);
    
    return { ...conta, tipo: 'Receber' as const };
  }


  async listarCadastros(): Promise<FinanceiroCatalogosDTO> {
    const [bancos, tipos, formas, centros] = await Promise.all([
      this.prisma.bancoFinanceiro.findMany({ orderBy: { nome: 'asc' } }),
      this.prisma.tipoContabilFinanceiro.findMany({ orderBy: { descricao: 'asc' } }),
      this.prisma.formaPagamentoFinanceira.findMany({ orderBy: { nome: 'asc' } }),
      this.prisma.centroResultadoFinanceiro.findMany({ orderBy: { nome: 'asc' } }),
    ]);

    return {
      bancos,
      tiposContabeis: tipos,
      formasPagamento: formas,
      centrosResultado: centros,
    };
  }

  async criarBanco(data: BancoFinanceiroInput) {
    return this.prisma.bancoFinanceiro.create({
      data: {
        nome: data.nome,
        agencia: data.agencia,
        conta: data.conta,
        saldo: data.saldo ?? 0,
        ativo: data.ativo ?? true,
      },
    });
  }

  async removerBanco(id: number) {
    return this.prisma.bancoFinanceiro.delete({ where: { id } });
  }

  async criarTipoContabil(data: TipoContabilFinanceiroInput) {
    return this.prisma.tipoContabilFinanceiro.create({
      data: {
        descricao: data.descricao,
        natureza: data.natureza,
        ativo: data.ativo ?? true,
      },
    });
  }

  async removerTipoContabil(id: number) {
    return this.prisma.tipoContabilFinanceiro.delete({ where: { id } });
  }

  async criarFormaPagamento(data: FormaPagamentoFinanceiraInput) {
    return this.prisma.formaPagamentoFinanceira.create({
      data: {
        nome: data.nome,
        prazo: data.prazo,
        ativo: data.ativo ?? true,
      },
    });
  }

  async removerFormaPagamento(id: number) {
    return this.prisma.formaPagamentoFinanceira.delete({ where: { id } });
  }

  async criarCentroResultado(data: CentroResultadoFinanceiroInput) {
    return this.prisma.centroResultadoFinanceiro.create({
      data: {
        nome: data.nome,
        descricao: data.descricao,
        orcamento: data.orcamento ?? 0,
        ativo: data.ativo ?? true,
      },
    });
  }

  async removerCentroResultado(id: number) {
    return this.prisma.centroResultadoFinanceiro.delete({ where: { id } });
  }

  async getRelatorioFinanceiro(): Promise<FinanceiroRelatorioDTO> {
    const cached = RELATORIO_CACHE.get(this.tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    const [contasPagar, contasReceber, comissoes, recibos] = await Promise.all([
      this.prisma.contaPagar.findMany(),
      this.prisma.contaReceber.findMany({
        include: {
          cliente: {
            select: {
              id: true,
              nome: true,
          email: true,
          telefone: true,
          cpf: true,
        },
      },
        },
      }),
      this.prisma.comissao.findMany({
        include: {
          vendedor: {
            select: {
              id: true,
              nome: true,
            },
          },
        },
      }),
      this.prisma.recibo.findMany(),
    ]);

    const entradas = contasReceber.reduce((acc, conta) => acc + (conta.valor ?? 0), 0);
    const saidas = contasPagar.reduce((acc, conta) => acc + (conta.valor ?? 0), 0);
    const lucro = entradas - saidas;
    const margem = entradas > 0 ? (lucro / entradas) * 100 : 0;

    const result: FinanceiroRelatorioDTO = {
      totais: {
        entradas,
        saidas,
        lucro,
        margem,
      },
      mensal: this.buildSeriesMensal(contasPagar, contasReceber),
      distribuicao: this.buildDistribuicaoCategorias(contasPagar),
      comissoes: this.buildComissoesResumo(comissoes),
      recibos: this.buildRecibosResumo(recibos, contasPagar.length, contasReceber.length),
    };
    RELATORIO_CACHE.set(this.tenantId, {
      data: result,
      expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
    });
    return result;
  }

  async getMetricasRecorrencia() {
    const cached = RECORRENCIA_CACHE.get(this.tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    const hoje = new Date();
    const inicioMes = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), 1));
    const inicioMesAnterior = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - 1, 1));
    const fimMesAnterior = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), 0));

    const [contasRecorrentes, contasUnicas, assinaturasCanceladas] = await Promise.all([
      // Receitas recorrentes (com asaasSubscriptionId) deste mês
      this.prisma.contaReceber.findMany({
        where: {
          asaasSubscriptionId: { not: null },
          vencimento: { gte: inicioMes },
          status: { not: 'CANCELADO' }
        }
      }),
      // Receitas únicas (sem asaasSubscriptionId) deste mês
      this.prisma.contaReceber.findMany({
        where: {
          asaasSubscriptionId: null,
          vencimento: { gte: inicioMes },
          status: { not: 'CANCELADO' }
        }
      }),
      // Assinaturas canceladas no mês anterior (para churn)
      // NOTE: Usando vencimento como proxy pois updatedAt não existe no schema atual e migrações estão pausadas
      this.prisma.contaReceber.findMany({
        where: {
          asaasSubscriptionId: { not: null },
          status: 'CANCELADO',
          vencimento: {
            gte: inicioMesAnterior,
            lte: fimMesAnterior
          }
        }
      })
    ]);

    const mrr = contasRecorrentes.reduce((acc, c) => acc + (c.valor || 0), 0);
    const revenueOneTime = contasUnicas.reduce((acc, c) => acc + (c.valor || 0), 0);
    
    // Simplistic Churn calculation: Cancelled / (Active + Cancelled)
    // In a real scenario, we'd need the total active subscriptions at start of month
    const activeSubscriptionsCount = contasRecorrentes.length; // Approximate
    const cancelledCount = assinaturasCanceladas.length;
    const totalBase = activeSubscriptionsCount + cancelledCount;
    const churnRate = totalBase > 0 ? (cancelledCount / totalBase) * 100 : 0;

    const result = {
      mrr,
      revenueOneTime,
      churnRate,
      activeSubscriptions: activeSubscriptionsCount,
      cancelledSubscriptions: cancelledCount
    };
    RECORRENCIA_CACHE.set(this.tenantId, {
      data: result,
      expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS,
    });
    return result;
  }

  private buildSeriesMensal(contasPagar: ContaPagarType[], contasReceber: ContaReceberType[]) {
    const now = new Date();
    const meses: Array<{ key: string; label: string }> = [];

    for (let i = 5; i >= 0; i--) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
      const label = date.toLocaleDateString('pt-BR', { month: 'short' });
      meses.push({ key, label });
    }

    const sumByMonth = (items: Array<{ vencimento: Date; valor: number | null }>) => {
      return meses.map(({ key, label }) => {
        const total = items
          .filter((item) => {
            if (!item.vencimento) return false;
            const date = new Date(item.vencimento);
            const compareKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
            return compareKey === key;
          })
          .reduce((acc, item) => acc + (item.valor ?? 0), 0);

        return { mes: label, total };
      });
    };

    const entradasPorMes = sumByMonth(
      contasReceber.map((conta) => ({ vencimento: conta.vencimento, valor: conta.valor })),
    );
    const saidasPorMes = sumByMonth(
      contasPagar.map((conta) => ({ vencimento: conta.vencimento, valor: conta.valor })),
    );

    return entradasPorMes.map((entrada, index) => ({
      mes: entrada.mes,
      entradas: entrada.total,
      saidas: saidasPorMes[index]?.total ?? 0,
    }));
  }

  private buildDistribuicaoCategorias(contasPagar: ContaPagarType[]) {
    const grupos = contasPagar.reduce<Record<string, number>>((acc, conta) => {
      const chave = (conta.fornecedor || 'Outros').trim();
      acc[chave] = (acc[chave] ?? 0) + (conta.valor ?? 0);
      return acc;
    }, {});

    return Object.entries(grupos)
      .map(([nome, valor]) => ({ nome, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 6);
  }

  private buildComissoesResumo(comissoes: ComissaoType[]) {
    const mapa = new Map<
      string,
      {
        vendas: number;
        comissao: number;
      }
    >();

    comissoes.forEach((comissao) => {
      const nome = comissao.vendedor?.nome || `Consultor #${comissao.vendedorId}`;
      if (!mapa.has(nome)) {
        mapa.set(nome, { vendas: 0, comissao: 0 });
      }
      const item = mapa.get(nome)!;
      item.vendas += comissao.valor ?? 0;
      item.comissao += comissao.valor ?? 0;
    });

    return Array.from(mapa.entries()).map(([nome, valores]) => ({
      nome,
      vendas: valores.vendas,
      comissao: valores.comissao,
    }));
  }

  private buildRecibosResumo(recibos: ReciboType[], contasPagar: number, contasReceber: number) {
    const totalRecibos = recibos.length;
    const valorRecibos = recibos.reduce((acc, recibo) => acc + (recibo.valor ?? 0), 0);

    return [
      { tipo: 'Recibos emitidos', total: totalRecibos },
      { tipo: 'Valor total', total: Number(valorRecibos.toFixed(2)) },
      { tipo: 'Pagamentos pendentes', total: contasPagar },
      { tipo: 'Recebimentos pendentes', total: contasReceber },
    ];
  }

  async reconsultarContaReceber(id: number, usuarioId?: number): Promise<ContaFinanceiraDTO> {
    const conta = await this.prisma.contaReceber.findUnique({
      where: { id },
      include: {
        cliente: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
            cpf: true,
          },
        },
      },
    });

    if (!conta) {
      throw new Error('Conta a receber não encontrada');
    }

    if (!conta.asaasPaymentId && !conta.asaasSubscriptionId) {
      throw new Error('Conta não está vinculada ao Asaas');
    }

    if (!this.asaasIntegration.isEnabled()) {
      throw new Error('Integração com Asaas desabilitada para este tenant');
    }

    const sincronizada = await this.asaasIntegration.refreshPaymentStatus(id);

    this.logger.info('Reconsulta de status solicitada pelo usuário', {
      tenantId: this.tenantId,
      contaReceberId: id,
      asaasPaymentId: sincronizada.asaasPaymentId ?? conta.asaasPaymentId,
      asaasSubscriptionId: sincronizada.asaasSubscriptionId ?? conta.asaasSubscriptionId,
      usuarioId,
    });

    return { ...sincronizada, tipo: 'Receber' as const };
  }
}
