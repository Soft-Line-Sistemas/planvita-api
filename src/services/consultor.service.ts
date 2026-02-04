import { Prisma, getPrismaForTenant } from '../utils/prisma';

type ConsultorType = Prisma.ConsultorGetPayload<{}>;
type ConsultorResumoType = Prisma.ConsultorGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        nome: true;
        email: true;
      };
    };
  };
}>;

export class ConsultorService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<ConsultorType[]> {
    return this.prisma.consultor.findMany();
  }

  async getById(id: number): Promise<ConsultorType | null> {
    return this.prisma.consultor.findUnique({ where: { id: Number(id) } });
  }

  async create(data: ConsultorType): Promise<ConsultorType> {
    return this.prisma.consultor.create({ data });
  }

  async update(id: number, data: Partial<ConsultorType>): Promise<ConsultorType> {
    return this.prisma.consultor.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<ConsultorType> {
    return this.prisma.consultor.delete({ where: { id: Number(id) } });
  }

  async getResumoByUserId(userId: number) {
    const consultor = (await this.prisma.consultor.findUnique({
      where: { userId: Number(userId) },
      include: {
        user: {
          select: {
            id: true,
            nome: true,
            email: true,
          },
        },
      },
    })) as ConsultorResumoType | null;

    if (!consultor) return null;

    const [pendente, pago] = await Promise.all([
      this.prisma.comissao.aggregate({
        where: { vendedorId: consultor.id, statusPagamento: 'PENDENTE' },
        _sum: { valor: true },
      }),
      this.prisma.comissao.aggregate({
        where: { vendedorId: consultor.id, statusPagamento: 'PAGO' },
        _sum: { valor: true },
      }),
    ]);

    return {
      ...consultor,
      comissaoPendente: pendente._sum.valor ?? 0,
      comissaoPaga: pago._sum.valor ?? 0,
    };
  }

  async listarComissoesByUserId(userId: number) {
    const consultor = await this.prisma.consultor.findUnique({
      where: { userId: Number(userId) },
      select: { id: true, nome: true },
    });

    if (!consultor) return null;

    const comissoes = await this.prisma.comissao.findMany({
      where: { vendedorId: consultor.id },
      orderBy: { dataGeracao: 'desc' },
      include: {
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

    return {
      consultor,
      comissoes,
      totais: {
        pendente: comissoes
          .filter((c) => c.statusPagamento === 'PENDENTE')
          .reduce((acc, c) => acc + (c.valor ?? 0), 0),
        pago: comissoes
          .filter((c) => c.statusPagamento === 'PAGO')
          .reduce((acc, c) => acc + (c.valor ?? 0), 0),
      },
    };
  }
}
