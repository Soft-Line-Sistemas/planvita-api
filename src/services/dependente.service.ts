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

  private invalidDateError(): Error {
    const err: any = new Error(
      'dataNascimento inválida. Use formato YYYY-MM-DD ou ISO-8601 completo.',
    );
    err.status = 400;
    return err;
  }

  private parseDataNascimento(value: unknown): Date {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw this.invalidDateError();
      return value;
    }

    if (typeof value !== 'string') throw this.invalidDateError();

    const normalized = value.trim();
    if (!normalized) throw this.invalidDateError();

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return new Date(`${normalized}T00:00:00.000Z`);
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) throw this.invalidDateError();
    return parsed;
  }

  private normalizeCreateInput(data: DependenteCreateInput): DependenteCreateInput {
    return {
      ...data,
      dataNascimento: this.parseDataNascimento((data as any)?.dataNascimento),
    };
  }

  private normalizeUpdateInput(data: DependenteUpdateInput): DependenteUpdateInput {
    if (!Object.prototype.hasOwnProperty.call(data, 'dataNascimento')) {
      return data;
    }

    const current = (data as any).dataNascimento;
    if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      Object.prototype.hasOwnProperty.call(current, 'set')
    ) {
      return {
        ...data,
        dataNascimento: {
          ...current,
          set: this.parseDataNascimento(current.set),
        },
      };
    }

    return {
      ...data,
      dataNascimento: this.parseDataNascimento(current),
    };
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
    const normalizedData = this.normalizeCreateInput(data);
    const titularId = Number((normalizedData as any)?.titularId);
    if (!Number.isFinite(titularId) || titularId <= 0) {
      const err: any = new Error('titularId inválido.');
      err.status = 400;
      throw err;
    }

    await this.validarLimiteBeneficiarios(titularId);
    const dependente = await this.prisma.dependente.create({ data: normalizedData });

    await this.pricingService.recalcularDependentesDoTitular(titularId);
    return dependente;
  }

  async update(id: number, data: DependenteUpdateInput): Promise<DependenteType> {
    const normalizedData = this.normalizeUpdateInput(data);
    const atual = await this.prisma.dependente.findUnique({
      where: { id: Number(id) },
      select: { id: true, titularId: true },
    });
    if (!atual) {
      const err: any = new Error('Dependente não encontrado.');
      err.status = 404;
      throw err;
    }

    if ((normalizedData as any)?.titularId) {
      const titularId = Number((normalizedData as any).titularId);
      if (!Number.isFinite(titularId) || titularId <= 0) {
        const err: any = new Error('titularId inválido.');
        err.status = 400;
        throw err;
      }
      await this.validarLimiteBeneficiarios(titularId, 1, Number(id));
    }

    const dependente = await this.prisma.dependente.update({
      where: { id: Number(id) },
      data: normalizedData,
    });

    const titularIdAtualizado =
      Number((normalizedData as any)?.titularId) > 0
        ? Number((normalizedData as any).titularId)
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
