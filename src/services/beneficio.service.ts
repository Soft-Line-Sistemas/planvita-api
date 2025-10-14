import prisma, { Prisma } from '../utils/prisma';

type BeneficioType = Prisma.BeneficioGetPayload<{}>;

export class BeneficioService {
  async getAll(): Promise<BeneficioType[]> {
    return prisma.beneficio.findMany();
  }

  async getById(id: number): Promise<BeneficioType | null> {
    return prisma.beneficio.findUnique({ where: { id: Number(id) } });
  }

  async create(data: BeneficioType): Promise<BeneficioType> {
    return prisma.beneficio.create({ data });
  }

  async update(id: number, data: Partial<BeneficioType>): Promise<BeneficioType> {
    return prisma.beneficio.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<BeneficioType> {
    return prisma.beneficio.delete({ where: { id: Number(id) } });
  }
}
