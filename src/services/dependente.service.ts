import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { TitularPricingService } from './titular-pricing.service';
import { canonicalizeRelationship } from './family-relationship.service';

type DependenteType = Prisma.DependenteGetPayload<{}>;
type DependenteCreateInput = Prisma.DependenteUncheckedCreateInput;
type DependenteUpdateInput = Prisma.DependenteUncheckedUpdateInput;
const MAX_DEPENDENTES_POR_TITULAR = 8;

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
    const carenciaInicioRaw = (data as any)?.carenciaInicioEm;
    return {
      ...data,
      dataNascimento: this.parseDataNascimento((data as any)?.dataNascimento),
      carenciaInicioEm:
        carenciaInicioRaw instanceof Date
          ? carenciaInicioRaw
          : typeof carenciaInicioRaw === 'string' && carenciaInicioRaw.trim()
            ? this.parseDataNascimento(carenciaInicioRaw)
            : new Date(),
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

  private calcularIdade(dataNascimento: Date): number | null {
    if (!(dataNascimento instanceof Date) || Number.isNaN(dataNascimento.getTime())) {
      return null;
    }

    const hoje = new Date();
    let idade = hoje.getFullYear() - dataNascimento.getFullYear();
    const deltaMes = hoje.getMonth() - dataNascimento.getMonth();

    if (deltaMes < 0 || (deltaMes === 0 && hoje.getDate() < dataNascimento.getDate())) {
      idade -= 1;
    }

    return idade >= 0 ? idade : null;
  }

  private async validarIdadeMaximaDependente(dataNascimento: Date) {
    const regras = await this.prisma.businessRules.findFirst({
      where: { tenantId: this.tenantId },
      select: { idadeMaximaDependente: true },
    });

    const idadeMaximaDependente = regras?.idadeMaximaDependente ?? null;
    if (!Number.isFinite(idadeMaximaDependente) || idadeMaximaDependente === null || idadeMaximaDependente < 0) {
      return;
    }

    const idadeInformada = this.calcularIdade(dataNascimento);
    if (idadeInformada === null) {
      throw this.invalidDateError();
    }

    if (idadeInformada > idadeMaximaDependente) {
      const err: any = new Error(
        `Dependente excede a idade máxima permitida (${idadeMaximaDependente} anos).`,
      );
      err.status = 400;
      err.code = 'IDADE_MAXIMA_DEPENDENTE_EXCEDIDA';
      err.meta = {
        idadeMaximaDependente,
        idadeInformada,
      };
      throw err;
    }
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

    const limiteConfigurado = regras?.limiteBeneficiarios ?? null;
    const limite =
      !limiteConfigurado || limiteConfigurado <= 0
        ? MAX_DEPENDENTES_POR_TITULAR
        : Math.min(limiteConfigurado, MAX_DEPENDENTES_POR_TITULAR);

    const [totalAtual, titular] = await Promise.all([
      this.prisma.dependente.count({
        where: {
          titularId,
          ...(ignorarDependenteId ? { id: { not: ignorarDependenteId } } : {}),
        },
      }),
      this.prisma.titular.findUnique({
        where: { id: titularId },
        select: {
          nome: true,
          cpf: true,
          corresponsaveis: {
            orderBy: { id: 'asc' },
            select: {
              nome: true,
              cpf: true,
              relacionamento: true,
            },
          },
        },
      }),
    ]);

    const corresponsavel = titular?.corresponsaveis?.[0] ?? null;
    const titularCpf = String(titular?.cpf ?? '').replace(/\D/g, '');
    const corresponsavelCpf = String(corresponsavel?.cpf ?? '').replace(/\D/g, '');
    const corresponsavelMesmoTitular =
      (titularCpf && corresponsavelCpf && titularCpf === corresponsavelCpf) ||
      canonicalizeRelationship(corresponsavel?.relacionamento) === 'titular' ||
      (String(titular?.nome ?? '').trim().toLowerCase() &&
        String(titular?.nome ?? '').trim().toLowerCase() ===
          String(corresponsavel?.nome ?? '').trim().toLowerCase());
    const vagasConsumidasCorresponsavel = corresponsavel && !corresponsavelMesmoTitular ? 1 : 0;

    if (totalAtual + vagasConsumidasCorresponsavel + novosDependentes > limite) {
      const err: any = new Error(`Limite de beneficiários (${limite}) atingido.`);
      err.status = 400;
      err.code = 'LIMITE_BENEFICIARIOS_EXCEDIDO';
      err.meta = {
        limiteBeneficiarios: limite,
        totalDependentes: totalAtual + vagasConsumidasCorresponsavel,
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
    await this.validarIdadeMaximaDependente((normalizedData as any).dataNascimento);
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

    const currentDataNascimento = (normalizedData as any)?.dataNascimento;
    if (currentDataNascimento instanceof Date) {
      await this.validarIdadeMaximaDependente(currentDataNascimento);
    } else if (currentDataNascimento?.set instanceof Date) {
      await this.validarIdadeMaximaDependente(currentDataNascimento.set);
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
