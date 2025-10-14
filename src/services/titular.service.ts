import prisma, { Prisma } from '../utils/prisma';

type TitularType = Prisma.TitularGetPayload<{}>;

export class TitularService {
  async getAll(): Promise<TitularType[]> {
    return prisma.titular.findMany();
  }

  async getById(id: number): Promise<TitularType | null> {
    return prisma.titular.findUnique({ where: { id: Number(id) } });
  }

  async create(data: TitularType): Promise<TitularType> {
    return prisma.titular.create({ data });
  }

  async update(id: number, data: Partial<TitularType>): Promise<TitularType> {
    return prisma.titular.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<TitularType> {
    return prisma.titular.delete({ where: { id: Number(id) } });
  }
}
