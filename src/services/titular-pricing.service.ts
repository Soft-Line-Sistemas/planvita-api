import { getPrismaForTenant } from '../utils/prisma';
import { AsaasIntegrationService } from './asaas-integration.service';
import {
  canonicalizeRelationship,
  isRelationshipInGrade,
} from './family-relationship.service';

type FaixaTarifacaoDependente = {
  idadeMaxima: number | null;
  valor: number;
};

const MATRIZ_PROGRESSIVA_PADRAO: FaixaTarifacaoDependente[] = [
  { idadeMaxima: 60, valor: 9.9 },
  { idadeMaxima: 70, valor: 19.9 },
  { idadeMaxima: 80, valor: 29.9 },
  { idadeMaxima: null, valor: 49 },
];

export class TitularPricingService {
  private prisma;
  private asaasIntegration: AsaasIntegrationService;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
    this.asaasIntegration = new AsaasIntegrationService(tenantId);
  }

  private arredondarMoeda(valor: number): number {
    return Math.round((valor + Number.EPSILON) * 100) / 100;
  }

  private normalizarMatrizTarifacao(
    raw: unknown,
  ): FaixaTarifacaoDependente[] | null {
    if (!Array.isArray(raw)) return null;

    const faixas = raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const registro = item as Record<string, unknown>;
        const idadeMaximaRaw =
          registro.idadeMaxima ?? registro.maxAge ?? registro.ageLimit ?? null;
        const valorRaw = registro.valor ?? registro.value ?? registro.tarifa ?? null;
        const valor = Number(valorRaw);

        if (!Number.isFinite(valor) || valor < 0) return null;

        if (idadeMaximaRaw === null || idadeMaximaRaw === undefined || idadeMaximaRaw === '') {
          return {
            idadeMaxima: null,
            valor: this.arredondarMoeda(valor),
          };
        }

        const idadeMaxima = Number(idadeMaximaRaw);
        if (!Number.isInteger(idadeMaxima) || idadeMaxima < 0) return null;

        return {
          idadeMaxima,
          valor: this.arredondarMoeda(valor),
        };
      })
      .filter((item): item is FaixaTarifacaoDependente => item !== null)
      .sort((a, b) => {
        if (a.idadeMaxima === null) return 1;
        if (b.idadeMaxima === null) return -1;
        return a.idadeMaxima - b.idadeMaxima;
      });

    if (!faixas.length) return null;

    const ultimaFaixa = faixas[faixas.length - 1];
    if (ultimaFaixa.idadeMaxima !== null) {
      faixas.push({
        idadeMaxima: null,
        valor: ultimaFaixa.valor,
      });
    }

    return faixas;
  }

  private async obterMatrizTarifacaoDependente(): Promise<FaixaTarifacaoDependente[]> {
    const regras = await this.prisma.businessRules.findFirst({
      where: { tenantId: this.tenantId },
      select: {
        valorAdicionalDependenteForaGrade: true,
        valorAdicionalDependenteForaGradeFaixasJson: true,
      },
    });

    const matrizConfigurada = String(
      regras?.valorAdicionalDependenteForaGradeFaixasJson ?? '',
    ).trim();
    if (matrizConfigurada) {
      try {
        const parsed = JSON.parse(matrizConfigurada);
        const matriz = this.normalizarMatrizTarifacao(parsed);
        if (matriz) return matriz;
      } catch {
        // Fallback para matriz padrão/legado abaixo.
      }
    }

    const valorLegado = Number(regras?.valorAdicionalDependenteForaGrade ?? NaN);
    if (Number.isFinite(valorLegado) && valorLegado >= 0) {
      return [{ idadeMaxima: null, valor: this.arredondarMoeda(valorLegado) }];
    }

    return MATRIZ_PROGRESSIVA_PADRAO;
  }

  private calcularIdade(dataNascimento?: Date | null): number | null {
    if (!(dataNascimento instanceof Date) || Number.isNaN(dataNascimento.getTime())) {
      return null;
    }

    const hoje = new Date();
    let idade = hoje.getFullYear() - dataNascimento.getFullYear();
    const deltaMes = hoje.getMonth() - dataNascimento.getMonth();
    if (
      deltaMes < 0 ||
      (deltaMes === 0 && hoje.getDate() < dataNascimento.getDate())
    ) {
      idade -= 1;
    }

    return idade >= 0 ? idade : null;
  }

  private obterValorAdicionalPorFaixaEtaria(
    idade: number,
    matriz: FaixaTarifacaoDependente[],
  ): number {
    for (const faixa of matriz) {
      if (faixa.idadeMaxima === null || idade <= faixa.idadeMaxima) {
        return faixa.valor;
      }
    }

    return matriz[matriz.length - 1]?.valor ?? 0;
  }

  async recalcularDependente(dependenteId: number): Promise<void> {
    const dependente = await this.prisma.dependente.findUnique({
      where: { id: Number(dependenteId) },
      select: {
        id: true,
        titularId: true,
      },
    });

    if (!dependente) return;
    await this.recalcularDependentesDoTitular(dependente.titularId);
  }

  async recalcularDependentesDoTitular(titularId: number): Promise<void> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: Number(titularId) },
      include: {
        plano: {
          include: {
            beneficiarios: true,
          },
        },
        dependentes: true,
      },
    });

    if (!titular) return;

    const beneficiariosPlano = titular.plano?.beneficiarios?.map((b: { nome: string }) => b.nome) ?? [];
    const matrizTarifacao = await this.obterMatrizTarifacaoDependente();

    for (const dependente of titular.dependentes) {
      const parentescoNormalizado = canonicalizeRelationship(
        dependente.tipoDependente,
      );
      const foraGradeFamiliar = !isRelationshipInGrade(
        dependente.tipoDependente,
        beneficiariosPlano,
      );
      const idadeDependente = this.calcularIdade(dependente.dataNascimento);

      if (
        foraGradeFamiliar &&
        !dependente.excluirCobrancaAdicional &&
        idadeDependente === null
      ) {
        const err: any = new Error(
          `Dependente ${dependente.nome} está sem data de nascimento válida para tarifação progressiva.`,
        );
        err.status = 400;
        err.code = 'DEPENDENTE_DATA_NASCIMENTO_INVALIDA';
        err.meta = {
          dependenteId: dependente.id,
          titularId: titular.id,
        };
        throw err;
      }

      const valorAdicionalMensal =
        foraGradeFamiliar && !dependente.excluirCobrancaAdicional
          ? this.obterValorAdicionalPorFaixaEtaria(idadeDependente as number, matrizTarifacao)
          : 0;

      await this.prisma.dependente.update({
        where: { id: dependente.id },
        data: {
          parentescoNormalizado,
          foraGradeFamiliar,
          valorAdicionalMensal,
        },
      });
    }

    await this.recalcularFinanceiroTitular(titular.id);
  }

  async recalcularFinanceiroTitular(titularId: number): Promise<number> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: Number(titularId) },
      include: {
        plano: true,
        dependentes: {
          select: { valorAdicionalMensal: true },
        },
      },
    });

    if (!titular?.plano) return 0;

    const valorPlano = Number(titular.plano.valorMensal ?? 0);
    const valorAdicionais = titular.dependentes.reduce((acc: number, dep: { valorAdicionalMensal: number }) => {
      return acc + Number(dep.valorAdicionalMensal ?? 0);
    }, 0);

    const telemedicinaContratada = this.normalizarServicosAdicionais(
      titular.servicosAdicionaisJson,
    ).includes('telemedicina');
    const valorTelemedicina = telemedicinaContratada ? 19.9 : 0;
    const valorTotalMensal = this.arredondarMoeda(
      valorPlano + valorAdicionais + valorTelemedicina,
    );

    await this.prisma.titular.update({
      where: { id: titular.id },
      data: {
        valorTotalContrato: valorTotalMensal,
      },
    });

    const contasAbertas = await this.prisma.contaReceber.findMany({
      where: {
        clienteId: titular.id,
        status: {
          in: ['PENDENTE', 'ATRASADO', 'PENDENCIA', 'VENCIDO'],
        },
      },
      select: {
        id: true,
        asaasPaymentId: true,
      },
    });

    for (const conta of contasAbertas) {
      await this.prisma.contaReceber.update({
        where: { id: conta.id },
        data: {
          valor: valorTotalMensal,
        },
      });

      if (conta.asaasPaymentId) {
        await this.asaasIntegration.updatePaymentForContaReceber(conta.id, {
          value: valorTotalMensal,
        });
      }
    }

    return valorTotalMensal;
  }

  private normalizarServicosAdicionais(raw?: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => String(item ?? '').trim().toLowerCase())
        .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
    } catch {
      return [];
    }
  }
}
