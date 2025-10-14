import prisma, { Prisma } from '../utils/prisma';

type PagamentoType = Prisma.PagamentoGetPayload<{}>;

export class PagamentoService {
  async getAll(): Promise<PagamentoType[]> {
    return prisma.pagamento.findMany();
  }

  async getById(id: number): Promise<PagamentoType | null> {
    return prisma.pagamento.findUnique({ where: { id: Number(id) } });
  }

  async create(data: PagamentoType): Promise<PagamentoType> {
    return prisma.pagamento.create({ data });
  }

  async update(id: number, data: Partial<PagamentoType>): Promise<PagamentoType> {
    return prisma.pagamento.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<PagamentoType> {
    return prisma.pagamento.delete({ where: { id: Number(id) } });
  }
}
