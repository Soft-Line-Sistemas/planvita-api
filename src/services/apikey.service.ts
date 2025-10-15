import { Prisma, getPrismaForTenant } from '../utils/prisma';

type ApiKeyType = Prisma.ApiKeyGetPayload<{}>;

export class ApiKeyService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }
  async getAll(): Promise<ApiKeyType[]> {
    return this.prisma.apiKey.findMany();
  }

  async getById(id: number): Promise<ApiKeyType | null> {
    return this.prisma.apiKey.findUnique({ where: { id: String(id) } });
  }

  async create(data: ApiKeyType): Promise<ApiKeyType> {
    return this.prisma.apiKey.create({ data });
  }

  async update(id: number, data: Partial<ApiKeyType>): Promise<ApiKeyType> {
    return this.prisma.apiKey.update({ where: { id: String(id) }, data });
  }

  async delete(id: number): Promise<ApiKeyType> {
    return this.prisma.apiKey.delete({ where: { id: String(id) } });
  }
}
