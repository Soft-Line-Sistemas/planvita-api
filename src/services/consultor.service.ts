import { Prisma, getPrismaForTenant } from '../utils/prisma';

type ConsultorType = Prisma.ConsultorGetPayload<{}>;

export class ConsultorService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<ConsultorType[]> {
    return this.prisma.consultor.findMany();
  }

  async getById(id: number): Promise<ConsultorType | null> {
    return this.prisma.consultor.findUnique({ where: { id: Number(id) } });
  }

  async create(data: ConsultorType): Promise<ConsultorType> {
    return this.prisma.consultor.create({ data });
  }

  async update(id: number, data: Partial<ConsultorType>): Promise<ConsultorType> {
    return this.prisma.consultor.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<ConsultorType> {
    return this.prisma.consultor.delete({ where: { id: Number(id) } });
  }
}
