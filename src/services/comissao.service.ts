import { Prisma, getPrismaForTenant } from '../utils/prisma';

type ComissaoType = Prisma.ComissaoGetPayload<{}>;

export class ComissaoService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<ComissaoType[]> {
    return this.prisma.comissao.findMany();
  }

  async getById(id: number): Promise<ComissaoType | null> {
    return this.prisma.comissao.findUnique({ where: { id: Number(id) } });
  }

  async create(data: ComissaoType): Promise<ComissaoType> {
    return this.prisma.comissao.create({ data });
  }

  async update(id: number, data: Partial<ComissaoType>): Promise<ComissaoType> {
    return this.prisma.comissao.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<ComissaoType> {
    return this.prisma.comissao.delete({ where: { id: Number(id) } });
  }
}
