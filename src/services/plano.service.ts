import prisma, { Prisma } from '../utils/prisma';

type PlanoType = Prisma.PlanoGetPayload<{}>;

export class PlanoService {
  async getAll(): Promise<PlanoType[]> {
    return prisma.plano.findMany();
  }

  async getById(id: number): Promise<PlanoType | null> {
    return prisma.plano.findUnique({ where: { id: Number(id) } });
  }

  async create(data: PlanoType): Promise<PlanoType> {
    return prisma.plano.create({ data });
  }

  async update(id: number, data: Partial<PlanoType>): Promise<PlanoType> {
    return prisma.plano.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<PlanoType> {
    return prisma.plano.delete({ where: { id: Number(id) } });
  }
}
