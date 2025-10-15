import { Prisma, getPrismaForTenant } from '../utils/prisma';

type CorresponsavelType = Prisma.CorresponsavelGetPayload<{}>;

export class CorresponsavelService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<CorresponsavelType[]> {
    return this.prisma.corresponsavel.findMany();
  }

  async getById(id: number): Promise<CorresponsavelType | null> {
    return this.prisma.corresponsavel.findUnique({ where: { id: Number(id) } });
  }

  async create(data: CorresponsavelType): Promise<CorresponsavelType> {
    return this.prisma.corresponsavel.create({ data });
  }

  async update(id: number, data: Partial<CorresponsavelType>): Promise<CorresponsavelType> {
    return this.prisma.corresponsavel.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<CorresponsavelType> {
    return this.prisma.corresponsavel.delete({ where: { id: Number(id) } });
  }
}
