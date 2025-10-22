import { Prisma, getPrismaForTenant } from '../utils/prisma';

type BusinessRulesType = Prisma.BusinessRulesGetPayload<{}>;

export class RegrasService {
   private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll() {
    return this.prisma.businessRules.findMany();
  }

  async getByTenant(tenantId: string) {
    return this.prisma.businessRules.findFirst({
      where: { tenantId },
    });
  }

  async create(data: BusinessRulesType) {
    return this.prisma.businessRules.create({ data });
  }

  async update(tenantId: string, data: BusinessRulesType) {
    return this.prisma.businessRules.update({
      where: { tenantId },
      data,
    });
  }
}
