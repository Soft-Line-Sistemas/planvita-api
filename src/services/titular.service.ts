import { Prisma, getPrismaForTenant } from '../utils/prisma';

type TitularType = Prisma.TitularGetPayload<{}>;

export class TitularService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<TitularType[]> {
    return this.prisma.titular.findMany();
  }

  async getById(id: number): Promise<TitularType | null> {
    return this.prisma.titular.findUnique({ where: { id: Number(id) } });
  }

  async create(data: TitularType): Promise<TitularType> {
    return this.prisma.titular.create({ data });
  }

  async update(id: number, data: Partial<TitularType>): Promise<TitularType> {
    return this.prisma.titular.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<TitularType> {
    return this.prisma.titular.delete({ where: { id: Number(id) } });
  }
}
