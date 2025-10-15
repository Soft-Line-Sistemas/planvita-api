import { Prisma, getPrismaForTenant } from '../utils/prisma';

type LayoutConfigType = Prisma.LayoutConfigGetPayload<{}>;

export class LayoutConfigService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<LayoutConfigType[]> {
    return this.prisma.layoutConfig.findMany();
  }

  async getById(id: number): Promise<LayoutConfigType | null> {
    return this.prisma.layoutConfig.findUnique({ where: { id: Number(id) } });
  }

  async create(data: LayoutConfigType): Promise<LayoutConfigType> {
    return this.prisma.layoutConfig.create({ data });
  }

  async update(id: number, data: Partial<LayoutConfigType>): Promise<LayoutConfigType> {
    return this.prisma.layoutConfig.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<LayoutConfigType> {
    return this.prisma.layoutConfig.delete({ where: { id: Number(id) } });
  }
}
