import { getPrismaForTenant, Prisma } from '../utils/prisma';

type PagamentoType = Prisma.PagamentoGetPayload<{}>;

export class PagamentoService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<PagamentoType[]> {
    return this.prisma.pagamento.findMany();
  }

  async getById(id: number): Promise<PagamentoType | null> {
    return this.prisma.pagamento.findUnique({ where: { id: Number(id) } });
  }

  async create(data: PagamentoType): Promise<PagamentoType> {
    return this.prisma.pagamento.create({ data });
  }

  async update(id: number, data: Partial<PagamentoType>): Promise<PagamentoType> {
    return this.prisma.pagamento.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<PagamentoType> {
    return this.prisma.pagamento.delete({ where: { id: Number(id) } });
  }
}
