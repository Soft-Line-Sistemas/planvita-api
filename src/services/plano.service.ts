import { Prisma, getPrismaForTenant } from '../utils/prisma';

type PlanoType = Prisma.PlanoGetPayload<{}>;

export class PlanoService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<PlanoType[]> {
    return this.prisma.plano.findMany();
  }

  async getById(id: number): Promise<PlanoType | null> {
    return this.prisma.plano.findUnique({ where: { id: Number(id) } });
  }

  async create(data: PlanoType): Promise<PlanoType> {
    return this.prisma.plano.create({ data });
  }

  async update(id: number, data: Partial<PlanoType>): Promise<PlanoType> {
    return this.prisma.plano.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<PlanoType> {
    return this.prisma.plano.delete({ where: { id: Number(id) } });
  }
}
