import { Prisma, getPrismaForTenant } from '../utils/prisma';

type DependenteType = Prisma.DependenteGetPayload<{}>;

export class DependenteService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<DependenteType[]> {
    return this.prisma.dependente.findMany();
  }

  async getById(id: number): Promise<DependenteType | null> {
    return this.prisma.dependente.findUnique({ where: { id: Number(id) } });
  }

  private async validarLimiteBeneficiarios(
    titularId: number,
    novosDependentes = 1,
    ignorarDependenteId?: number,
  ) {
    const regras = await this.prisma.businessRules.findFirst({
      where: { tenantId: this.tenantId },
      select: { limiteBeneficiarios: true },
    });

    const limite = regras?.limiteBeneficiarios ?? null;
    if (!limite || limite <= 0) return;

    const totalAtual = await this.prisma.dependente.count({
      where: {
        titularId,
        ...(ignorarDependenteId ? { id: { not: ignorarDependenteId } } : {}),
      },
    });

    if (totalAtual + novosDependentes > limite) {
      const err: any = new Error(`Limite de beneficiários (${limite}) atingido.`);
      err.status = 400;
      err.code = 'LIMITE_BENEFICIARIOS_EXCEDIDO';
      err.meta = {
        limiteBeneficiarios: limite,
        totalDependentes: totalAtual,
      };
      throw err;
    }
  }

  async create(data: DependenteType): Promise<DependenteType> {
    const titularId = Number((data as any)?.titularId);
    if (!Number.isFinite(titularId) || titularId <= 0) {
      const err: any = new Error('titularId inválido.');
      err.status = 400;
      throw err;
    }

    await this.validarLimiteBeneficiarios(titularId);
    return this.prisma.dependente.create({ data });
  }

  async update(id: number, data: Partial<DependenteType>): Promise<DependenteType> {
    if ((data as any)?.titularId) {
      const titularId = Number((data as any).titularId);
      if (!Number.isFinite(titularId) || titularId <= 0) {
        const err: any = new Error('titularId inválido.');
        err.status = 400;
        throw err;
      }
      await this.validarLimiteBeneficiarios(titularId, 1, Number(id));
    }
    return this.prisma.dependente.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<DependenteType> {
    return this.prisma.dependente.delete({ where: { id: Number(id) } });
  }
}
