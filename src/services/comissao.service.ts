import prisma, { Prisma } from '../utils/prisma';

type ComissaoType = Prisma.ComissaoGetPayload<{}>;

export class ComissaoService {
  async getAll(): Promise<ComissaoType[]> {
    return prisma.comissao.findMany();
  }

  async getById(id: number): Promise<ComissaoType | null> {
    return prisma.comissao.findUnique({ where: { id: Number(id) } });
  }

  async create(data: ComissaoType): Promise<ComissaoType> {
    return prisma.comissao.create({ data });
  }

  async update(id: number, data: Partial<ComissaoType>): Promise<ComissaoType> {
    return prisma.comissao.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<ComissaoType> {
    return prisma.comissao.delete({ where: { id: Number(id) } });
  }
}
