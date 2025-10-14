import prisma, { Prisma } from '../utils/prisma';

type LayoutConfigType = Prisma.LayoutConfigGetPayload<{}>;

export class LayoutConfigService {
  async getAll(): Promise<LayoutConfigType[]> {
    return prisma.layoutConfig.findMany();
  }

  async getById(id: number): Promise<LayoutConfigType | null> {
    return prisma.layoutConfig.findUnique({ where: { id: Number(id) } });
  }

  async create(data: LayoutConfigType): Promise<LayoutConfigType> {
    return prisma.layoutConfig.create({ data });
  }

  async update(id: number, data: Partial<LayoutConfigType>): Promise<LayoutConfigType> {
    return prisma.layoutConfig.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<LayoutConfigType> {
    return prisma.layoutConfig.delete({ where: { id: Number(id) } });
  }
}
