import prisma, { Prisma } from '../utils/prisma';

type RoleType = Prisma.RoleGetPayload<{}>;

export class RoleService {
  async getAll() {
    return prisma.role.findMany({
      include: {
        RolePermission: {
          select: { permissionId: true },
        },
      },
    });
  }

  async getById(id: number) {
    return prisma.role.findUnique({
      where: { id },
      include: {
        RolePermission: {
          select: { permissionId: true },
        },
      },
    });
  }

  async create(data: RoleType): Promise<RoleType> {
    return prisma.role.create({ data });
  }

  async update(id: number, data: Partial<RoleType>): Promise<RoleType> {
    return prisma.role.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<RoleType> {
    return prisma.role.delete({ where: { id: Number(id) } });
  }

  async updatePermissions(roleId: number, permissionIds: number[]) {
    await prisma.rolePermission.deleteMany({ where: { roleId } });

    const newPermissions = permissionIds.map((pid) => ({
      roleId,
      permissionId: pid,
    }));

    await prisma.rolePermission.createMany({ data: newPermissions });

    return {
      roleId,
      updatedPermissions: permissionIds,
    };
  }
}
