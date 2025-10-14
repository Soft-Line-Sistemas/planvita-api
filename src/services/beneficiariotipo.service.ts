import prisma, { Prisma } from '../utils/prisma';

type BeneficiarioTipoType = Prisma.BeneficiarioTipoGetPayload<{}>;

export class BeneficiarioTipoService {
  async getAll(): Promise<BeneficiarioTipoType[]> {
    return prisma.beneficiarioTipo.findMany();
  }

  async getById(id: number): Promise<BeneficiarioTipoType | null> {
    return prisma.beneficiarioTipo.findUnique({ where: { id: Number(id) } });
  }

  async create(data: BeneficiarioTipoType): Promise<BeneficiarioTipoType> {
    return prisma.beneficiarioTipo.create({ data });
  }

  async update(id: number, data: Partial<BeneficiarioTipoType>): Promise<BeneficiarioTipoType> {
    return prisma.beneficiarioTipo.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<BeneficiarioTipoType> {
    return prisma.beneficiarioTipo.delete({ where: { id: Number(id) } });
  }
}
