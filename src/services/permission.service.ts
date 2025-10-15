import { Prisma, getPrismaForTenant } from '../utils/prisma';

type PermissionType = Prisma.PermissionGetPayload<{}>;

export class PermissionService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<PermissionType[]> {
    return this.prisma.permission.findMany();
  }

  async getById(id: number): Promise<PermissionType | null> {
    return this.prisma.permission.findUnique({ where: { id: Number(id) } });
  }

  async create(data: PermissionType): Promise<PermissionType> {
    return this.prisma.permission.create({ data });
  }

  async update(id: number, data: Partial<PermissionType>): Promise<PermissionType> {
    return this.prisma.permission.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<PermissionType> {
    return this.prisma.permission.delete({ where: { id: Number(id) } });
  }
}
