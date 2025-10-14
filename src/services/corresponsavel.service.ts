import prisma, { Prisma } from '../utils/prisma';

type CorresponsavelType = Prisma.CorresponsavelGetPayload<{}>;

export class CorresponsavelService {
  async getAll(): Promise<CorresponsavelType[]> {
    return prisma.corresponsavel.findMany();
  }

  async getById(id: number): Promise<CorresponsavelType | null> {
    return prisma.corresponsavel.findUnique({ where: { id: Number(id) } });
  }

  async create(data: CorresponsavelType): Promise<CorresponsavelType> {
    return prisma.corresponsavel.create({ data });
  }

  async update(id: number, data: Partial<CorresponsavelType>): Promise<CorresponsavelType> {
    return prisma.corresponsavel.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<CorresponsavelType> {
    return prisma.corresponsavel.delete({ where: { id: Number(id) } });
  }
}
