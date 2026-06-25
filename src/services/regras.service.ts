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
  redirecionamentoWhatsappAtivo: true,
  redirecionamentoWhatsappNumero: true,
  redirecionamentoWhatsappIdadeMin: true,
  redirecionamentoWhatsappIdadeMax: true,
  ativo: true,
  criadoEm: true,
  atualizadoEm: true,
});

type BusinessRulesLegacyRow = Prisma.BusinessRulesGetPayload<{
  select: typeof BUSINESS_RULES_LEGACY_SELECT;
}>;

type BusinessRulesPayload = Partial<
  Prisma.BusinessRulesCreateInput & {
    maxBeneficiarios?: number | null;
    carenciaDias?: number | null;
    vigenciaMeses?: number | null;
  }
>;

export class RegrasService {
  private prisma;
  private static readonly DEFAULT_MAX_BENEFICIARIOS = 8;

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
      maxBeneficiarios:
        rule.limiteBeneficiarios && rule.limiteBeneficiarios > 0
          ? rule.limiteBeneficiarios
          : RegrasService.DEFAULT_MAX_BENEFICIARIOS,
      carenciaDias: null,
      redirecionamentoWhatsappAtivo: rule.redirecionamentoWhatsappAtivo ?? false,
      redirecionamentoWhatsappNumero: rule.redirecionamentoWhatsappNumero ?? null,
      redirecionamentoWhatsappIdadeMin: rule.redirecionamentoWhatsappIdadeMin ?? 18,
      redirecionamentoWhatsappIdadeMax: rule.redirecionamentoWhatsappIdadeMax ?? 65,
    };
  }

  private normalizePayload(data: BusinessRulesPayload, forUpdate = false) {
    const payload: Prisma.BusinessRulesUncheckedCreateInput = {
      tenantId: this.tenantId,
    };

    const assignIfDefined = <K extends keyof Prisma.BusinessRulesUncheckedCreateInput>(
      key: K,
      value: Prisma.BusinessRulesUncheckedCreateInput[K] | undefined,
    ) => {
      if (value !== undefined) {
        payload[key] = value;
      }
    };

    assignIfDefined('diasAvisoVencimento', data.diasAvisoVencimento as number | null | undefined);
    assignIfDefined('diasAvisoPendencia', data.diasAvisoPendencia as number | null | undefined);
    assignIfDefined('repeticaoPendenciaDias', data.repeticaoPendenciaDias as number | null | undefined);
    assignIfDefined('diasSuspensaoPreventiva', data.diasSuspensaoPreventiva as number | null | undefined);
    assignIfDefined('diasSuspensao', data.diasSuspensao as number | null | undefined);
    assignIfDefined('diasPosSuspensao', data.diasPosSuspensao as number | null | undefined);
    assignIfDefined('avisoReajusteAnual', data.avisoReajusteAnual as boolean | null | undefined);
    assignIfDefined('diasAntesReajusteAnual', data.diasAntesReajusteAnual as number | null | undefined);
    assignIfDefined('avisoRenovacaoAutomatica', data.avisoRenovacaoAutomatica as boolean | null | undefined);
    assignIfDefined('diasAntesRenovacao', data.diasAntesRenovacao as number | null | undefined);
    assignIfDefined('permitirEstoqueNegativo', data.permitirEstoqueNegativo as boolean | null | undefined);
    assignIfDefined('notificarEstoqueBaixo', data.notificarEstoqueBaixo as boolean | null | undefined);
    assignIfDefined('quantidadeMinimaEstoque', data.quantidadeMinimaEstoque as number | null | undefined);
    assignIfDefined('notificarServicoPendente', data.notificarServicoPendente as boolean | null | undefined);
    assignIfDefined('idadeMaximaDependente', data.idadeMaximaDependente as number | null | undefined);
    assignIfDefined(
      'limiteBeneficiarios',
      (
        data.limiteBeneficiarios !== undefined
          ? data.limiteBeneficiarios
          : data.maxBeneficiarios
      ) as number | null | undefined,
    );
    assignIfDefined('maximoBeneficiariosPorTipo', data.maximoBeneficiariosPorTipo as number | null | undefined);
    assignIfDefined(
      'valorAdicionalDependenteForaGrade',
      data.valorAdicionalDependenteForaGrade as number | null | undefined,
    );
    assignIfDefined(
      'valorAdicionalDependenteForaGradeFaixasJson',
      data.valorAdicionalDependenteForaGradeFaixasJson as string | null | undefined,
    );
    assignIfDefined('quilometragemMaxVeiculo', data.quilometragemMaxVeiculo as number | null | undefined);
    assignIfDefined('notificarManutencao', data.notificarManutencao as boolean | null | undefined);
    assignIfDefined('intervaloManutencaoKm', data.intervaloManutencaoKm as number | null | undefined);
    assignIfDefined('intervaloManutencaoDias', data.intervaloManutencaoDias as number | null | undefined);
    assignIfDefined(
      'diasAntesAvisoRenovacaoSepultamento',
      data.diasAntesAvisoRenovacaoSepultamento as number | null | undefined,
    );
    assignIfDefined('limiteTempoUsoSepultamento', data.limiteTempoUsoSepultamento as number | null | undefined);
    assignIfDefined('notificarTaxaVencida', data.notificarTaxaVencida as boolean | null | undefined);
    assignIfDefined('tipoAvisoTaxaVencida', data.tipoAvisoTaxaVencida as string | null | undefined);
    assignIfDefined(
      'redirecionamentoWhatsappAtivo',
      data.redirecionamentoWhatsappAtivo as boolean | null | undefined,
    );
    assignIfDefined(
      'redirecionamentoWhatsappNumero',
      data.redirecionamentoWhatsappNumero as string | null | undefined,
    );
    assignIfDefined(
      'redirecionamentoWhatsappIdadeMin',
      data.redirecionamentoWhatsappIdadeMin as number | null | undefined,
    );
    assignIfDefined(
      'redirecionamentoWhatsappIdadeMax',
      data.redirecionamentoWhatsappIdadeMax as number | null | undefined,
    );
    assignIfDefined('ativo', data.ativo as boolean | null | undefined);

    if (forUpdate) {
      delete (payload as Partial<Prisma.BusinessRulesUncheckedCreateInput>).tenantId;
      if (Object.keys(payload).length === 0) {
        const err: any = new Error('Nenhum campo válido para atualizar');
        err.status = 400;
        throw err;
      }
    }

    return payload;
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

  async create(data: BusinessRulesPayload) {
    const rule = await this.prisma.businessRules.create({
      data: this.normalizePayload(data, false),
      select: BUSINESS_RULES_LEGACY_SELECT,
    });
    return this.withWhatsappDefaults(rule);
  }

  async update(tenantId: string, data: BusinessRulesPayload) {
    const rule = await this.prisma.businessRules.update({
      where: { tenantId },
      data: this.normalizePayload(data, true),
      select: BUSINESS_RULES_LEGACY_SELECT,
    });
    return this.withWhatsappDefaults(rule);
  }
}
