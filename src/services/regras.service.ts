import { Prisma, getPrismaForTenant } from '../utils/prisma';

type BusinessRulesType = Prisma.BusinessRulesGetPayload<{}>;
const BUSINESS_RULES_LEGACY_SELECT = Prisma.validator<Prisma.BusinessRulesSelect>()({
  tenantId: true,
  diasAvisoVencimento: true,
  diasAvisoPendencia: true,
  repeticaoPendenciaDias: true,
  diasSuspensaoPreventiva: true,
  diasSuspensao: true,
  diasPosSuspensao: true,
  avisoReajusteAnual: true,
  diasAntesReajusteAnual: true,
  avisoRenovacaoAutomatica: true,
  diasAntesRenovacao: true,
  permitirEstoqueNegativo: true,
  notificarEstoqueBaixo: true,
  quantidadeMinimaEstoque: true,
  notificarServicoPendente: true,
  idadeMaximaDependente: true,
  limiteBeneficiarios: true,
  maximoBeneficiariosPorTipo: true,
  valorAdicionalDependenteForaGrade: true,
  valorAdicionalDependenteForaGradeFaixasJson: true,
  quilometragemMaxVeiculo: true,
  notificarManutencao: true,
  intervaloManutencaoKm: true,
  intervaloManutencaoDias: true,
  diasAntesAvisoRenovacaoSepultamento: true,
  limiteTempoUsoSepultamento: true,
  notificarTaxaVencida: true,
  tipoAvisoTaxaVencida: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
});

type BusinessRulesLegacyRow = Prisma.BusinessRulesGetPayload<{
  select: typeof BUSINESS_RULES_LEGACY_SELECT;
}>;

export class RegrasService {
   private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  private withWhatsappDefaults<T extends BusinessRulesLegacyRow | null>(rule: T) {
    if (!rule) return rule;
    return {
      ...rule,
      redirecionamentoWhatsappAtivo: false,
      redirecionamentoWhatsappNumero: null,
      redirecionamentoWhatsappIdadeMin: 18,
      redirecionamentoWhatsappIdadeMax: 65,
    };
  }

  private sanitizeWriteData<T extends BusinessRulesType | Partial<BusinessRulesType>>(data: T): T {
    const {
      redirecionamentoWhatsappAtivo: _ativo,
      redirecionamentoWhatsappNumero: _numero,
      redirecionamentoWhatsappIdadeMin: _idadeMin,
      redirecionamentoWhatsappIdadeMax: _idadeMax,
      ...legacyData
    } = (data ?? {}) as Record<string, unknown>;

    return legacyData as T;
  }

  async getAll() {
    const rows = await this.prisma.businessRules.findMany({
      select: BUSINESS_RULES_LEGACY_SELECT,
    });
    return rows.map((row) => this.withWhatsappDefaults(row));
  }

  async getByTenant(tenantId: string) {
    const rule = await this.prisma.businessRules.findFirst({
      where: { tenantId },
      select: BUSINESS_RULES_LEGACY_SELECT,
    });
    return this.withWhatsappDefaults(rule);
  }

  async create(data: BusinessRulesType) {
    return this.prisma.businessRules.create({
      data: this.sanitizeWriteData(data),
    });
  }

  async update(tenantId: string, data: BusinessRulesType) {
    return this.prisma.businessRules.update({
      where: { tenantId },
      data: this.sanitizeWriteData(data),
    });
  }
}
