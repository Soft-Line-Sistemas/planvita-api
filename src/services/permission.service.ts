import prisma, { Prisma } from '../utils/prisma';

type PermissionType = Prisma.PermissionGetPayload<{}>;

export class PermissionService {
  async getAll(): Promise<PermissionType[]> {
    return prisma.permission.findMany();
  }

  async getById(id: number): Promise<PermissionType | null> {
    return prisma.permission.findUnique({ where: { id: Number(id) } });
  }

  async create(data: PermissionType): Promise<PermissionType> {
    return prisma.permission.create({ data });
  }

  async update(id: number, data: Partial<PermissionType>): Promise<PermissionType> {
    return prisma.permission.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<PermissionType> {
    return prisma.permission.delete({ where: { id: Number(id) } });
  }
}
