import { Prisma, getPrismaForTenant } from '../utils/prisma';

type PermissionType = Prisma.PermissionGetPayload<{}>;
type PermissionCreateInput = Prisma.PermissionCreateInput;
type PermissionUpdateInput = Prisma.PermissionUpdateInput;

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

  private validateCreate(data: Partial<PermissionCreateInput>) {
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const description =
      typeof data.description === 'string' ? data.description.trim() : data.description;

    if (!name) {
      const error = new Error('Nome é obrigatório') as Error & { status?: number };
      error.status = 400;
      throw error;
    }

    return {
      name,
      ...(description !== undefined ? { description } : {}),
    };
  }

  async create(data: Partial<PermissionCreateInput>): Promise<PermissionType> {
    return this.prisma.permission.create({ data: this.validateCreate(data) });
  }

  private validateUpdate(data: Partial<PermissionUpdateInput>) {
    const payload: Partial<PermissionUpdateInput> = {};

    if (data.name !== undefined) {
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name) {
        const error = new Error('Nome é obrigatório') as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      payload.name = name;
    }

    if (data.description !== undefined) {
      payload.description =
        typeof data.description === 'string' ? data.description.trim() : data.description;
    }

    if (Object.keys(payload).length === 0) {
      const error = new Error('Nenhum campo válido para atualizar') as Error & { status?: number };
      error.status = 400;
      throw error;
    }

    return payload;
  }

  async update(id: number, data: Partial<PermissionUpdateInput>): Promise<PermissionType> {
    return this.prisma.permission.update({
      where: { id: Number(id) },
      data: this.validateUpdate(data),
    });
  }

  async delete(id: number): Promise<PermissionType> {
    return this.prisma.permission.delete({ where: { id: Number(id) } });
  }
}
