import { Prisma, getPrismaForTenant } from '../utils/prisma';

type DependenteType = Prisma.DependenteGetPayload<{}>;

export class DependenteService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<DependenteType[]> {
    return this.prisma.dependente.findMany();
  }

  async getById(id: number): Promise<DependenteType | null> {
    return this.prisma.dependente.findUnique({ where: { id: Number(id) } });
  }

  async create(data: DependenteType): Promise<DependenteType> {
    return this.prisma.dependente.create({ data });
  }

  async update(id: number, data: Partial<DependenteType>): Promise<DependenteType> {
    return this.prisma.dependente.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<DependenteType> {
    return this.prisma.dependente.delete({ where: { id: Number(id) } });
  }
}
