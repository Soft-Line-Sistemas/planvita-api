import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { TitularPricingService } from './titular-pricing.service';

type DependenteType = Prisma.DependenteGetPayload<{}>;
type DependenteCreateInput = Prisma.DependenteUncheckedCreateInput;
type DependenteUpdateInput = Prisma.DependenteUncheckedUpdateInput;

export class DependenteService {
  private prisma;
  private pricingService: TitularPricingService;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
    this.pricingService = new TitularPricingService(tenantId);
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

  async create(data: DependenteCreateInput): Promise<DependenteType> {
    const titularId = Number((data as any)?.titularId);
    if (!Number.isFinite(titularId) || titularId <= 0) {
      const err: any = new Error('titularId inválido.');
      err.status = 400;
      throw err;
    }

    await this.validarLimiteBeneficiarios(titularId);
    const dependente = await this.prisma.dependente.create({ data });

    await this.pricingService.recalcularDependentesDoTitular(titularId);
    return dependente;
  }

  async update(id: number, data: DependenteUpdateInput): Promise<DependenteType> {
    const atual = await this.prisma.dependente.findUnique({
      where: { id: Number(id) },
      select: { id: true, titularId: true },
    });
    if (!atual) {
      const err: any = new Error('Dependente não encontrado.');
      err.status = 404;
      throw err;
    }

    if ((data as any)?.titularId) {
      const titularId = Number((data as any).titularId);
      if (!Number.isFinite(titularId) || titularId <= 0) {
        const err: any = new Error('titularId inválido.');
        err.status = 400;
        throw err;
      }
      await this.validarLimiteBeneficiarios(titularId, 1, Number(id));
    }

    const dependente = await this.prisma.dependente.update({
      where: { id: Number(id) },
      data,
    });

    const titularIdAtualizado =
      Number((data as any)?.titularId) > 0
        ? Number((data as any).titularId)
        : atual.titularId;

    await this.pricingService.recalcularDependentesDoTitular(titularIdAtualizado);
    return dependente;
  }

  async delete(id: number): Promise<DependenteType> {
    const atual = await this.prisma.dependente.findUnique({
      where: { id: Number(id) },
      select: { titularId: true },
    });
    const dependente = await this.prisma.dependente.delete({
      where: { id: Number(id) },
    });
    if (atual?.titularId) {
      await this.pricingService.recalcularDependentesDoTitular(atual.titularId);
    }
    return dependente;
  }
}
