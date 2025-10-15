import { Prisma, getPrismaForTenant } from '../utils/prisma';

type BeneficioType = Prisma.BeneficioGetPayload<{}>;

export class BeneficioService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<BeneficioType[]> {
    return this.prisma.beneficio.findMany();
  }

  async getById(id: number): Promise<BeneficioType | null> {
    return this.prisma.beneficio.findUnique({ where: { id: Number(id) } });
  }

  async create(data: BeneficioType): Promise<BeneficioType> {
    return this.prisma.beneficio.create({ data });
  }

  async update(id: number, data: Partial<BeneficioType>): Promise<BeneficioType> {
    return this.prisma.beneficio.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<BeneficioType> {
    return this.prisma.beneficio.delete({ where: { id: Number(id) } });
  }
}
