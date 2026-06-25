import { Prisma, getPrismaForTenant } from '../utils/prisma';

type RoleType = Prisma.RoleGetPayload<{}>;

export class RoleService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll() {
    return this.prisma.role.findMany({
      include: {
        RolePermission: {
          select: { permissionId: true },
        },
      },
    });
  }

  async getById(id: number) {
    return this.prisma.role.findUnique({
      where: { id },
      include: {
        RolePermission: {
          select: { permissionId: true },
        },
      },
    });
  }

  async create(data: RoleType): Promise<RoleType> {
    return this.prisma.role.create({ data });
  }

  async update(id: number, data: Partial<RoleType>): Promise<RoleType> {
    return this.prisma.role.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<RoleType> {
    return this.prisma.role.delete({ where: { id: Number(id) } });
  }

  async updatePermissions(roleId: number, permissionIds: number[]) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true },
    });
    if (!role) {
      const err: any = new Error('Role not found');
      err.status = 404;
      throw err;
    }

    await this.prisma.rolePermission.deleteMany({ where: { roleId } });

    const newPermissions = permissionIds.map((pid) => ({
      roleId,
      permissionId: pid,
    }));

    await this.prisma.rolePermission.createMany({ data: newPermissions });

    return {
      roleId,
      updatedPermissions: permissionIds,
    };
  }
}
