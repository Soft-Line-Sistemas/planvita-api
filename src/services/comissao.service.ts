import { Prisma, getPrismaForTenant } from '../utils/prisma';

type ComissaoType = Prisma.ComissaoGetPayload<{}>;
type ComissaoDetalhadaType = Prisma.ComissaoGetPayload<{
  include: {
    vendedor: {
      select: {
        id: true;
        nome: true;
      };
    };
    titular: {
      select: {
        id: true;
        nome: true;
        email: true;
        telefone: true;
      };
    };
    contaPagar: {
      select: {
        id: true;
        descricao: true;
        valor: true;
        status: true;
        vencimento: true;
        dataPagamento: true;
      };
    };
  };
}>;

export interface CreateComissaoManualInput {
  vendedorId: number;
  titularId: number;
  valor: number;
  dataGeracao?: Date | string;
  statusPagamento?: 'PENDENTE' | 'PAGO';
  criarContaPagar?: boolean;
  vencimentoContaPagar?: Date | string;
  descricaoContaPagar?: string;
  fornecedorContaPagar?: string;
}

export class ComissaoService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<ComissaoType[]> {
    return this.prisma.comissao.findMany();
  }

  async getById(id: number): Promise<ComissaoType | null> {
    return this.prisma.comissao.findUnique({ where: { id: Number(id) } });
  }

  private toDate(value?: Date | string): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  async createManual(data: CreateComissaoManualInput): Promise<ComissaoDetalhadaType> {
    const vendedorId = Number(data.vendedorId);
    const titularId = Number(data.titularId);
    const valor = Number(data.valor);
    const statusPagamento = data.statusPagamento === 'PAGO' ? 'PAGO' : 'PENDENTE';
    const criarContaPagar = data.criarContaPagar !== false;
    const dataGeracao = this.toDate(data.dataGeracao) ?? new Date();

    if (!Number.isFinite(vendedorId) || vendedorId <= 0) {
      throw new Error('vendedorId inválido');
    }
    if (!Number.isFinite(titularId) || titularId <= 0) {
      throw new Error('titularId inválido');
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new Error('valor inválido');
    }

    return this.prisma.$transaction(async (tx: any) => {
      const [vendedor, titular, comissaoExistente] = await Promise.all([
        tx.consultor.findUnique({
          where: { id: vendedorId },
          select: { id: true, nome: true },
        }),
        tx.titular.findUnique({
          where: { id: titularId },
          select: { id: true, nome: true },
        }),
        tx.comissao.findFirst({
          where: { titularId },
          select: { id: true },
        }),
      ]);

      if (!vendedor) throw new Error('Consultor não encontrado');
      if (!titular) throw new Error('Titular não encontrado');
      if (comissaoExistente) {
        throw new Error('Titular já possui comissão cadastrada');
      }

      let contaPagarId: number | null = null;
      if (criarContaPagar) {
        const vencimentoContaPagar = this.toDate(data.vencimentoContaPagar) ?? new Date();
        const contaPagar = await tx.contaPagar.create({
          data: {
            descricao:
              data.descricaoContaPagar?.trim() ||
              `Comissão manual do titular #${titular.id} - ${titular.nome}`,
            valor,
            vencimento: vencimentoContaPagar,
            fornecedor: data.fornecedorContaPagar?.trim() || vendedor.nome,
            status: statusPagamento === 'PAGO' ? 'PAGO' : 'PENDENTE',
            dataPagamento: statusPagamento === 'PAGO' ? new Date() : null,
          },
          select: { id: true },
        });
        contaPagarId = contaPagar.id;
      }

      return tx.comissao.create({
        data: {
          vendedorId,
          titularId,
          valor,
          dataGeracao,
          statusPagamento,
          contaPagarId: contaPagarId ?? undefined,
        },
        include: {
          vendedor: {
            select: {
              id: true,
              nome: true,
            },
          },
          titular: {
            select: {
              id: true,
              nome: true,
              email: true,
              telefone: true,
            },
          },
          contaPagar: {
            select: {
              id: true,
              descricao: true,
              valor: true,
              status: true,
              vencimento: true,
              dataPagamento: true,
            },
          },
        },
      });
    });
  }

  async create(data: ComissaoType): Promise<ComissaoType> {
    const titularId = Number((data as any)?.titularId);
    if (Number.isFinite(titularId) && titularId > 0) {
      const existente = await this.prisma.comissao.findFirst({
        where: { titularId },
        select: { id: true },
      });
      if (existente) {
        throw new Error('Titular já possui comissão cadastrada');
      }
    }
    return this.prisma.comissao.create({ data });
  }

  async update(id: number, data: Partial<ComissaoType>): Promise<ComissaoType> {
    const titularId = Number((data as any)?.titularId);
    if (Number.isFinite(titularId) && titularId > 0) {
      const existente = await this.prisma.comissao.findFirst({
        where: {
          titularId,
          id: {
            not: Number(id),
          },
        },
        select: { id: true },
      });
      if (existente) {
        throw new Error('Titular já possui comissão cadastrada');
      }
    }
    return this.prisma.comissao.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<ComissaoType> {
    return this.prisma.comissao.delete({ where: { id: Number(id) } });
  }
}
