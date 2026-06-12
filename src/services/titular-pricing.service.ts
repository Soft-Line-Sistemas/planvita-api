import { getPrismaForTenant } from '../utils/prisma';
import { AsaasIntegrationService } from './asaas-integration.service';
import {
  canonicalizeRelationship,
  isRelationshipInGrade,
} from './family-relationship.service';

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

  private async obterValorAdicionalPadrao(): Promise<number> {
    const regras = await this.prisma.businessRules.findFirst({
      where: { tenantId: this.tenantId },
      select: { valorAdicionalDependenteForaGrade: true },
    });

    const valorRegra = Number(regras?.valorAdicionalDependenteForaGrade ?? 14.9);
    if (!Number.isFinite(valorRegra) || valorRegra < 0) return 14.9;
    return this.arredondarMoeda(valorRegra);
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

  private obterValorAdicionalPorFaixaEtaria(idade: number | null): number {
    if (idade === null) {
      return 9.9;
    }
    if (idade <= 60) return 9.9;
    if (idade <= 70) return 19.9;
    if (idade <= 80) return 29.9;
    return 49;
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

    for (const dependente of titular.dependentes) {
      const parentescoNormalizado = canonicalizeRelationship(
        dependente.tipoDependente,
      );
      const foraGradeFamiliar = !isRelationshipInGrade(
        dependente.tipoDependente,
        beneficiariosPlano,
      );
      const idadeDependente = this.calcularIdade(dependente.dataNascimento);
      const valorAdicionalMensal =
        foraGradeFamiliar && !dependente.excluirCobrancaAdicional
          ? this.obterValorAdicionalPorFaixaEtaria(idadeDependente)
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
