import prisma, { Prisma } from '../utils/prisma';

type DependenteType = Prisma.DependenteGetPayload<{}>;

export class DependenteService {
  async getAll(): Promise<DependenteType[]> {
    return prisma.dependente.findMany();
  }

  async getById(id: number): Promise<DependenteType | null> {
    return prisma.dependente.findUnique({ where: { id: Number(id) } });
  }

  async create(data: DependenteType): Promise<DependenteType> {
    return prisma.dependente.create({ data });
  }

  async update(id: number, data: Partial<DependenteType>): Promise<DependenteType> {
    return prisma.dependente.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<DependenteType> {
    return prisma.dependente.delete({ where: { id: Number(id) } });
  }
}
