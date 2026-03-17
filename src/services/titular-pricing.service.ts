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

    const valorAdicionalPadrao = await this.obterValorAdicionalPadrao();
    const beneficiariosPlano = titular.plano?.beneficiarios?.map((b: { nome: string }) => b.nome) ?? [];

    for (const dependente of titular.dependentes) {
      const parentescoNormalizado = canonicalizeRelationship(
        dependente.tipoDependente,
      );
      const foraGradeFamiliar = !isRelationshipInGrade(
        dependente.tipoDependente,
        beneficiariosPlano,
      );
      const valorAdicionalMensal =
        foraGradeFamiliar && !dependente.excluirCobrancaAdicional
          ? valorAdicionalPadrao
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

    const valorTotalMensal = this.arredondarMoeda(valorPlano + valorAdicionais);

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
}
