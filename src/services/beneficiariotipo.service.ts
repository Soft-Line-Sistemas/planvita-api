import { Prisma, getPrismaForTenant } from '../utils/prisma';

type BeneficiarioTipoType = Prisma.BeneficiarioTipoGetPayload<{}>;

export class BeneficiarioTipoService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  private createValidationError(message: string) {
    const err: any = new Error(message);
    err.status = 400;
    return err;
  }

  private normalizeCreateData(data: Partial<BeneficiarioTipoType>) {
    const nome = String(data?.nome ?? '').trim();
    const idadeMaxRaw = (data as any)?.idadeMax;
    const idadeMax =
      idadeMaxRaw === undefined || idadeMaxRaw === null || idadeMaxRaw === ''
        ? null
        : Number(idadeMaxRaw);

    if (!nome) {
      throw this.createValidationError('Nome é obrigatório');
    }
    if (idadeMax !== null && (!Number.isFinite(idadeMax) || idadeMax < 0)) {
      throw this.createValidationError('idadeMax inválido');
    }

    return { nome, idadeMax };
  }

  async getAll(): Promise<BeneficiarioTipoType[]> {
    return this.prisma.beneficiarioTipo.findMany();
  }

  async getById(id: number): Promise<BeneficiarioTipoType | null> {
    return this.prisma.beneficiarioTipo.findUnique({ where: { id: Number(id) } });
  }

  async create(data: BeneficiarioTipoType): Promise<BeneficiarioTipoType> {
    return this.prisma.beneficiarioTipo.create({ data: this.normalizeCreateData(data) });
  }

  async update(id: number, data: Partial<BeneficiarioTipoType>): Promise<BeneficiarioTipoType> {
    const payload: Record<string, unknown> = {};
    if (data.nome !== undefined) {
      const nome = String(data.nome).trim();
      if (!nome) throw this.createValidationError('Nome é obrigatório');
      payload.nome = nome;
    }
    if ((data as any).idadeMax !== undefined) {
      const idadeMaxRaw = (data as any).idadeMax;
      if (idadeMaxRaw === null || idadeMaxRaw === '') {
        payload.idadeMax = null;
      } else {
        const idadeMax = Number(idadeMaxRaw);
        if (!Number.isFinite(idadeMax) || idadeMax < 0) {
          throw this.createValidationError('idadeMax inválido');
        }
        payload.idadeMax = idadeMax;
      }
    }
    return this.prisma.beneficiarioTipo.update({ where: { id: Number(id) }, data: payload });
  }

  async delete(id: number): Promise<BeneficiarioTipoType> {
    return this.prisma.beneficiarioTipo.delete({ where: { id: Number(id) } });
  }
}
