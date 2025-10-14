import prisma, { Prisma } from '../utils/prisma';

type ConsultorType = Prisma.ConsultorGetPayload<{}>;

export class ConsultorService {
  async getAll(): Promise<ConsultorType[]> {
    return prisma.consultor.findMany();
  }

  async getById(id: number): Promise<ConsultorType | null> {
    return prisma.consultor.findUnique({ where: { id: Number(id) } });
  }

  async create(data: ConsultorType): Promise<ConsultorType> {
    return prisma.consultor.create({ data });
  }

  async update(id: number, data: Partial<ConsultorType>): Promise<ConsultorType> {
    return prisma.consultor.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<ConsultorType> {
    return prisma.consultor.delete({ where: { id: Number(id) } });
  }
}
