import { getPrismaForTenant, Prisma } from '../utils/prisma';
import { AsaasIntegrationService } from './asaas-integration.service';
import Logger from '../utils/logger';

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

  async criarContaPagar(data: ContaPagarInput): Promise<ContaFinanceiraDTO> {
    const conta = await this.prisma.contaPagar.create({
      data: {
        descricao: data.descricao,
        valor: data.valor,
        vencimento: data.vencimento,
        fornecedor: data.fornecedor,
        status: 'PENDENTE',
      },
    });
    return { ...conta, tipo: 'Pagar' as const };
  }

  async criarContaReceber(data: ContaReceberInput): Promise<ContaFinanceiraDTO> {
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

    return {
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
