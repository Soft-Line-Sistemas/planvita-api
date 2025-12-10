import { getPrismaForTenant, Prisma } from '../utils/prisma';

type PagamentoType = Prisma.PagamentoGetPayload<{}>;
type PagamentoWithRelations = Prisma.PagamentoGetPayload<{
  include: {
    titular: {
      include: {
        plano: true;
      };
    };
  };
}>;

export class PagamentoService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<PagamentoWithRelations[]> {
    return this.prisma.pagamento.findMany({
      include: {
        titular: {
          include: {
            plano: true,
          },
        },
      },
    });
  }

  async getById(id: number): Promise<PagamentoWithRelations | null> {
    return this.prisma.pagamento.findUnique({
      where: { id: Number(id) },
      include: {
        titular: {
          include: {
            plano: true,
          },
        },
      },
    });
  }

  async create(data: PagamentoType): Promise<PagamentoType> {
    if ((data as any).asaasPaymentId) {
      const existing = await this.prisma.pagamento.findUnique({
        where: { asaasPaymentId: (data as any).asaasPaymentId },
      });

      if (existing) {
        return this.prisma.pagamento.update({
          where: { id: existing.id },
          data,
        });
      }
    }

    return this.prisma.pagamento.create({ data });
  }

  async update(id: number, data: Partial<PagamentoType>): Promise<PagamentoType> {
    return this.prisma.pagamento.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<PagamentoType> {
    return this.prisma.pagamento.delete({ where: { id: Number(id) } });
  }
}
