import { Prisma, getPrismaForTenant } from '../utils/prisma';

type BeneficiarioTipoType = Prisma.BeneficiarioTipoGetPayload<{}>;

export class BeneficiarioTipoService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<BeneficiarioTipoType[]> {
    return this.prisma.beneficiarioTipo.findMany();
  }

  async getById(id: number): Promise<BeneficiarioTipoType | null> {
    return this.prisma.beneficiarioTipo.findUnique({ where: { id: Number(id) } });
  }

  async create(data: BeneficiarioTipoType): Promise<BeneficiarioTipoType> {
    return this.prisma.beneficiarioTipo.create({ data });
  }

  async update(id: number, data: Partial<BeneficiarioTipoType>): Promise<BeneficiarioTipoType> {
    return this.prisma.beneficiarioTipo.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<BeneficiarioTipoType> {
    return this.prisma.beneficiarioTipo.delete({ where: { id: Number(id) } });
  }
}
