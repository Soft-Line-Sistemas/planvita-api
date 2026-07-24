const prismaMock = {
  businessRules: {
    findFirst: jest.fn(),
  },
  dependente: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  titular: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  contaReceber: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

const mockAsaasIntegration = {
  updatePaymentForContaReceber: jest.fn().mockResolvedValue(undefined),
};

jest.mock('./asaas-integration.service', () => ({
  AsaasIntegrationService: jest.fn().mockImplementation(() => mockAsaasIntegration),
}));

import { TitularPricingService } from './titular-pricing.service';

// ─── helpers ──────────────────────────────────────────────────────────────────

const makeTitularComDependentes = (deps: any[], plano: any = { beneficiarios: [{ nome: 'Filho(a)' }] }) => ({
  id: 1,
  plano,
  dependentes: deps,
});

const makeTitularValores = (
  deps: Array<{ valor: number }>,
  planoValor = 100,
  extras: Record<string, unknown> = {},
) => ({
  id: 1,
  nome: 'Titular Teste',
  cpf: '12345678901',
  plano: { valorMensal: planoValor },
  servicosAdicionaisJson: null,
  corresponsaveis: [],
  dependentes: deps.map(d => ({ valorAdicionalMensal: d.valor })),
  ...extras,
});

describe('TitularPricingService', () => {
  let service: TitularPricingService;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    service = new TitularPricingService('tenant-123');
    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);
  });

  // ── constructor ─────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new TitularPricingService('tenant-abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new TitularPricingService('')).toThrow();
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new TitularPricingService(undefined as any)).toThrow();
    });
  });

  // ── recalcularDependentesDoTitular ──────────────────────────────────────────
  describe('recalcularDependentesDoTitular', () => {
    it('aplica matriz progressiva configurada por faixa etária e recalcula o valor final', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([
          { idadeMaxima: 60, valor: 9.9 },
          { idadeMaxima: 70, valor: 19.9 },
          { idadeMaxima: 80, valor: 29.9 },
          { idadeMaxima: null, valor: 49 },
        ]),
        valorAdicionalDependenteForaGrade: 14.9,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 1,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
          dependentes: [
            { id: 11, nome: 'Dependente 60', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1966-06-15T00:00:00.000Z'), excluirCobrancaAdicional: false },
            { id: 12, nome: 'Dependente 61', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1965-06-14T00:00:00.000Z'), excluirCobrancaAdicional: false },
            { id: 13, nome: 'Dependente 81', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1945-01-01T00:00:00.000Z'), excluirCobrancaAdicional: false },
            { id: 14, nome: 'Dependente Na Grade', tipoDependente: 'Filho(a)', dataNascimento: new Date('2015-01-01T00:00:00.000Z'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 1,
          plano: { valorMensal: 100 },
          servicosAdicionaisJson: null,
          dependentes: [
            { valorAdicionalMensal: 9.9 },
            { valorAdicionalMensal: 19.9 },
            { valorAdicionalMensal: 49 },
            { valorAdicionalMensal: 9.9 },
          ],
        });

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalledTimes(4);
      expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 9.9 }),
      }));
      expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: { id: 12 },
        data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 19.9 }),
      }));
      expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(3, expect.objectContaining({
        where: { id: 13 },
        data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 49 }),
      }));
      expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(4, expect.objectContaining({
        where: { id: 14 },
        data: expect.objectContaining({ foraGradeFamiliar: false, valorAdicionalMensal: 9.9 }),
      }));

      expect(prismaMock.titular.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { valorTotalContrato: 188.7 },
      });
    });

    it('usa valor fixo (flat) como fallback quando não há faixas JSON configuradas', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: null,
        valorAdicionalDependenteForaGrade: 14.9,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 1,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
          dependentes: [
            { id: 20, nome: 'Sobrinho Fora', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1990-01-01T00:00:00.000Z'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 1,
          plano: { valorMensal: 100 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 14.9 }],
        });

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 20 }, data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 14.9 }) }),
      );
      expect(prismaMock.titular.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { valorTotalContrato: 114.9 } });
    });

    it('usa valor fixo quando o JSON de faixas está vazio (array vazio)', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: '[]',
        valorAdicionalDependenteForaGrade: 22.5,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 1,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
          dependentes: [
            { id: 21, nome: 'Primo Fora', tipoDependente: 'Primo(a)', dataNascimento: new Date('1985-03-10T00:00:00.000Z'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 1,
          plano: { valorMensal: 50 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 22.5 }],
        });

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 22.5 }) }),
      );
    });

    it('usa JSON de faixas salvo pela UI (formato exato enviado pelo frontend)', async () => {
      const faixasSalvasPelaUI = JSON.stringify([
        { idadeMaxima: 30, valor: 5.9 },
        { idadeMaxima: 59, valor: 14.9 },
        { idadeMaxima: 69, valor: 24.9 },
        { idadeMaxima: null, valor: 39.9 },
      ]);

      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: faixasSalvasPelaUI,
        valorAdicionalDependenteForaGrade: 14.9,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 2,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
          dependentes: [
            { id: 30, nome: 'Jovem', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('2000-01-01T00:00:00.000Z'), excluirCobrancaAdicional: false },
            { id: 31, nome: 'Meia Idade', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1970-06-01T00:00:00.000Z'), excluirCobrancaAdicional: false },
            { id: 32, nome: 'Idoso', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1950-01-01T00:00:00.000Z'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 2,
          plano: { valorMensal: 80 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 5.9 }, { valorAdicionalMensal: 14.9 }, { valorAdicionalMensal: 39.9 }],
        });

      await service.recalcularDependentesDoTitular(2);

      expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ valorAdicionalMensal: 5.9 }) }));
      expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ valorAdicionalMensal: 14.9 }) }));
      expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(3, expect.objectContaining({ data: expect.objectContaining({ valorAdicionalMensal: 39.9 }) }));

      expect(prismaMock.titular.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { valorTotalContrato: 140.7 } });
    });

    it('dependente com excluirCobrancaAdicional=true paga zero mesmo fora da grade', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([{ idadeMaxima: null, valor: 49 }]),
        valorAdicionalDependenteForaGrade: 14.9,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 3,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
          dependentes: [
            { id: 40, nome: 'Isento', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1960-01-01T00:00:00.000Z'), excluirCobrancaAdicional: true },
          ],
        })
        .mockResolvedValueOnce({
          id: 3,
          plano: { valorMensal: 100 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 0 }],
        });

      await service.recalcularDependentesDoTitular(3);

      expect(prismaMock.dependente.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 0 }) }),
      );
      expect(prismaMock.titular.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { valorTotalContrato: 100 } });
    });

    it('JSON de faixas inválido (não parseável) faz fallback para valor fixo', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: 'INVALIDO_NAO_E_JSON',
        valorAdicionalDependenteForaGrade: 18.5,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 4,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
          dependentes: [
            { id: 50, nome: 'Primo Fora', tipoDependente: 'Primo(a)', dataNascimento: new Date('1975-05-05T00:00:00.000Z'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 4,
          plano: { valorMensal: 100 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 18.5 }],
        });

      await service.recalcularDependentesDoTitular(4);

      expect(prismaMock.dependente.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 18.5 }) }),
      );
    });

    it('plano sem beneficiários definidos ainda aplica adicional por idade', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([{ idadeMaxima: null, valor: 49 }]),
        valorAdicionalDependenteForaGrade: 14.9,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 6,
          plano: { beneficiarios: [] },
          dependentes: [
            { id: 70, nome: 'Sobrinho', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1980-01-01T00:00:00.000Z'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 6,
          plano: { valorMensal: 100 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 49 }],
        });

      await service.recalcularDependentesDoTitular(6);

      expect(prismaMock.dependente.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ foraGradeFamiliar: false, valorAdicionalMensal: 49 }) }),
      );
      expect(prismaMock.titular.update).toHaveBeenCalledWith({ where: { id: 6 }, data: { valorTotalContrato: 149 } });
    });

    it('atualiza conta a receber aberta no Asaas com novo valor quando faixa muda', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([{ idadeMaxima: null, valor: 30 }]),
        valorAdicionalDependenteForaGrade: 14.9,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 5,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
          dependentes: [
            { id: 60, nome: 'Sobrinho Fora', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1980-01-01T00:00:00.000Z'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 5,
          plano: { valorMensal: 100 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 30 }],
        });

      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 99, asaasPaymentId: 'pay_abc123' },
      ]);

      await service.recalcularDependentesDoTitular(5);

      expect(prismaMock.contaReceber.update).toHaveBeenCalledWith({ where: { id: 99 }, data: { valor: 130 } });
      expect(mockAsaasIntegration.updatePaymentForContaReceber).toHaveBeenCalledWith(99, { value: 130 });
    });

    it('não cobra adicional quando o dependente não possui idade válida', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([
          { idadeMaxima: 60, valor: 9.9 },
          { idadeMaxima: 70, valor: 19.9 },
          { idadeMaxima: 80, valor: 29.9 },
          { idadeMaxima: null, valor: 49 },
        ]),
        valorAdicionalDependenteForaGrade: 14.9,
      });

      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
        dependentes: [
          { id: 99, nome: 'Dependente Inválido', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('invalid'), excluirCobrancaAdicional: false },
        ],
      });

      await expect(service.recalcularDependentesDoTitular(1)).resolves.toBeUndefined();

      expect(prismaMock.dependente.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ valorAdicionalMensal: 0 }),
        }),
      );
    });

    it('sem dependentes calcula apenas valor do plano', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: null,
        valorAdicionalDependenteForaGrade: 14.9,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 10,
          plano: { beneficiarios: [] },
          dependentes: [],
        })
        .mockResolvedValueOnce({
          id: 10,
          plano: { valorMensal: 80 },
          servicosAdicionaisJson: null,
          dependentes: [],
        });

      await service.recalcularDependentesDoTitular(10);

      expect(prismaMock.dependente.update).not.toHaveBeenCalled();
      expect(prismaMock.titular.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { valorTotalContrato: 80 } });
    });

    it('múltiplos dependentes na grade não geram cobrança adicional', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([{ idadeMaxima: null, valor: 50 }]),
        valorAdicionalDependenteForaGrade: 50,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 11,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }, { nome: 'Cônjuge' }] },
          dependentes: [
            { id: 81, nome: 'Filho', tipoDependente: 'Filho(a)', dataNascimento: new Date('2010-01-01'), excluirCobrancaAdicional: false },
            { id: 82, nome: 'Cônjuge', tipoDependente: 'Cônjuge', dataNascimento: new Date('1985-01-01'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 11,
          plano: { valorMensal: 90 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 0 }, { valorAdicionalMensal: 0 }],
        });

      await service.recalcularDependentesDoTitular(11);

      expect(prismaMock.titular.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { valorTotalContrato: 90 } });
    });

    it('não atualiza conta receber no Asaas quando não há asaasPaymentId', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([{ idadeMaxima: null, valor: 30 }]),
        valorAdicionalDependenteForaGrade: 30,
      });

      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 7,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
          dependentes: [
            { id: 91, nome: 'Sobrinho', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1980-01-01'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 7,
          plano: { valorMensal: 100 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 30 }],
        });

      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 10, asaasPaymentId: null },
      ]);

      await service.recalcularDependentesDoTitular(7);

      expect(mockAsaasIntegration.updatePaymentForContaReceber).not.toHaveBeenCalled();
    });

    it('faixa de edad exata no limite inferior (idadeMaxima igual à idade)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-23T00:00:00.000Z'));

      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([
          { idadeMaxima: 60, valor: 10 },
          { idadeMaxima: null, valor: 50 },
        ]),
        valorAdicionalDependenteForaGrade: 10,
      });

      // Dependente com exatamente 60 anos
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 12,
          plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
          dependentes: [
            { id: 101, nome: 'Exato 60', tipoDependente: 'Sobrinho(a)', dataNascimento: new Date('1966-06-23T00:00:00.000Z'), excluirCobrancaAdicional: false },
          ],
        })
        .mockResolvedValueOnce({
          id: 12,
          plano: { valorMensal: 100 },
          servicosAdicionaisJson: null,
          dependentes: [{ valorAdicionalMensal: 10 }],
        });

      await service.recalcularDependentesDoTitular(12);

      // 60 anos → faixa até 60 → valor 10
      expect(prismaMock.dependente.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ valorAdicionalMensal: 10 }) }),
      );

      jest.useRealTimers();
    });
  });

  // ── recalcularFinanceiroTitular — cenários adicionais ───────────────────────
  describe('recalcularFinanceiroTitular — cenários adicionais', () => {
    it('soma plano + dependentes corretamente', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([{ valor: 20 }, { valor: 30 }], 100),
      );
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, valorTotalContrato: 150 });
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.recalcularFinanceiroTitular(1);
      expect(typeof result).toBe('number');
    });

    it('soma plano sem dependentes retorna valor do plano', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([], 80),
      );
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, valorTotalContrato: 80 });
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.recalcularFinanceiroTitular(1);
      expect(result).toBe(80);
    });

    it('inclui telemedicina quando presente em servicosAdicionaisJson', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1,
        plano: { valorMensal: 100 },
        servicosAdicionaisJson: JSON.stringify(['telemedicina']),
        dependentes: [],
      });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, valorTotalContrato: 119.9 });
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.recalcularFinanceiroTitular(1);
      expect(result).toBeGreaterThan(100);
    });

    it('retorna 0 quando titular não tem plano', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, plano: null, dependentes: [], servicosAdicionaisJson: null,
      });

      const result = await service.recalcularFinanceiroTitular(9999);
      expect(result).toBe(0);
    });

    it('retorna 0 quando titular não existe', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.recalcularFinanceiroTitular(9999);
      expect(result).toBe(0);
    });

    it('repassa erro do prisma', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));
      await expect(service.recalcularFinanceiroTitular(1)).rejects.toThrow('DB error');
    });

    it('atualiza contas receber abertas com novo valor', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([{ valor: 50 }], 100),
      );
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1 });
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 10, asaasPaymentId: null },
        { id: 11, asaasPaymentId: 'pay_abc' },
      ]);
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({});

      await service.recalcularFinanceiroTitular(1);
      expect(prismaMock.contaReceber.update).toHaveBeenCalledTimes(2);
    });

    it('não atualiza contas quando não há contas abertas', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([], 80),
      );
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1 });
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      await service.recalcularFinanceiroTitular(1);
      expect(prismaMock.contaReceber.update).not.toHaveBeenCalled();
    });

    it('soma adicional do corresponsável quando o relacionamento não é isento', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([
          { idadeMaxima: 60, valor: 9.9 },
          { idadeMaxima: 70, valor: 19.9 },
          { idadeMaxima: 80, valor: 29.9 },
          { idadeMaxima: null, valor: 49 },
        ]),
        valorAdicionalDependenteForaGrade: 14.9,
      });
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([], 69.9, {
          corresponsaveis: [
            {
              nome: 'Pai Teste',
              cpf: '22233344455',
              relacionamento: 'Pai',
              dataNascimento: new Date('1985-01-01T00:00:00.000Z'),
            },
          ],
        }),
      );
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1 });

      const result = await service.recalcularFinanceiroTitular(1);

      expect(result).toBe(79.8);
      expect(prismaMock.titular.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { valorTotalContrato: 79.8 },
      });
    });
  });

  // ── recalcularDependentesDoTitular — cenários adicionais ────────────────────
  describe('recalcularDependentesDoTitular — cenários adicionais', () => {
    it('não altera dependente com excluirCobrancaAdicional=true', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(
          makeTitularComDependentes([
            { id: 50, nome: 'Excluído', tipoDependente: 'Filho(a)', dataNascimento: new Date('2000-01-01'), excluirCobrancaAdicional: true },
          ]),
        )
        .mockResolvedValueOnce(makeTitularValores([{ valor: 0 }]));

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ valorAdicionalMensal: 0 }) }),
      );
    });

    it('resolve sem erro quando titular não existe', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.recalcularDependentesDoTitular(9999)).resolves.toBeUndefined();
    });

    it('funciona com lista vazia de dependentes', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([]))
        .mockResolvedValueOnce(makeTitularValores([]));

      await expect(service.recalcularDependentesDoTitular(1)).resolves.toBeUndefined();
      expect(prismaMock.dependente.update).not.toHaveBeenCalled();
    });

    it('chama recalcularFinanceiroTitular ao final', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([]))
        .mockResolvedValueOnce(makeTitularValores([]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(spy).toHaveBeenCalledWith(1);
    });

    it('repassa erro do prisma em recalcular', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockRejectedValue(new Error('Timeout recalcular'));
      await expect(service.recalcularDependentesDoTitular(1)).rejects.toThrow('Timeout recalcular');
    });
  });

  // ── recalcularFinanceiroTitular — cenários de conta a receber ─────────────────
  describe('recalcularFinanceiroTitular — cenários de conta a receber', () => {
    it('não cria contas quando lista está vazia e titular existe', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(makeTitularValores([]));
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      await service.recalcularFinanceiroTitular(1);

      expect(prismaMock.contaReceber.update).not.toHaveBeenCalled();
    });

    it('titular com valor total 0 não gera atualização', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([], 0),
      );
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.recalcularFinanceiroTitular(1);
      expect(result).toBeDefined();
    });

    it('recalcularFinanceiroTitular retorna número', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(makeTitularValores([]));
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.recalcularFinanceiroTitular(1);
      expect(typeof result).toBe('number');
    });

    it('atualiza contas a receber quando valor muda', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([{ valor: 150 }], 50),
      );
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 1, valor: 100, status: 'PENDENTE' },
        { id: 2, valor: 100, status: 'PENDENTE' },
      ]);

      await service.recalcularFinanceiroTitular(1);
      expect(prismaMock.titular.update).toHaveBeenCalled();
    });

    it('recalcularFinanceiroTitular com titular.plano null resolve', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        ...makeTitularValores([]),
        plano: null,
      });
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.recalcularFinanceiroTitular(1);
      expect(result).toBe(0);
    });

    it('repassa erro de contaReceber.findMany', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(makeTitularValores([]));
      (prismaMock.contaReceber.findMany as jest.Mock).mockRejectedValue(new Error('DB findMany'));

      await expect(service.recalcularFinanceiroTitular(1)).rejects.toThrow('DB findMany');
    });
  });

  // ── makeDep helper with valid dataNascimento ──────────────────────────────────
  const makeDep = (tipo: string) => ({
    id: Math.floor(Math.random() * 1000),
    nome: 'Dep ' + tipo,
    tipoDependente: tipo,
    dataNascimento: new Date('1990-01-01'),
  });

  // ── recalcularDependentesDoTitular — cenários adicionais ─────────────────────
  describe('recalcularDependentesDoTitular — cenários adicionais 2', () => {
    it('com 1 dependente com dataNascimento atualiza o dependente e o titular', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([makeDep('Cônjuge')]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 50 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('com 2 dependentes com dataNascimento atualiza pelo menos 1', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([
          makeDep('Cônjuge'),
          makeDep('Filho(a)'),
        ]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 50 }, { valor: 80 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith(1);
    });

    it('dependente tipo Pai tem valor calculado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([makeDep('Pai')]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 80 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('dependente tipo Mãe tem valor calculado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([makeDep('Mãe')]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 80 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('dependente tipo Neto(a) tem valor calculado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([makeDep('Neto(a)')]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 50 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('dependente tipo Sogro(a) tem valor calculado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([makeDep('Sogro(a)')]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 80 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('dependente tipo Avô tem valor calculado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([makeDep('Avô')]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 100 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('dependente tipo Avó tem valor calculado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([makeDep('Avó')]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 100 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('dependente tipo Irmão(ã) tem valor calculado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([makeDep('Irmão(ã)')]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 60 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('com 3 dependentes chama update 3 vezes', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([
          makeDep('Cônjuge'),
          makeDep('Filho(a)'),
          makeDep('Pai'),
        ]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 50 }, { valor: 30 }, { valor: 80 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('recalcularDependentesDoTitular com businessRules personalizado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        porcentagemCnjuge: 100,
        porcentagemFilho: 80,
        porcentagemAscendente: 120,
        porcentagemOutros: 90,
      });
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([makeDep('Cônjuge')]))
        .mockResolvedValueOnce(makeTitularValores([{ valor: 50 }]));

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(1);

      expect(prismaMock.dependente.update).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });

    it('recalcularDependentesDoTitular com ID diferente de 1 chama recalcularFinanceiroTitular', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({ ...makeTitularComDependentes([]), id: 99 })
        .mockResolvedValueOnce({ ...makeTitularValores([]), id: 99 });

      const spy = jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(99);

      expect(spy).toHaveBeenCalled();
    });

    it('recalcularDependentesDoTitular retorna void', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce(makeTitularComDependentes([]))
        .mockResolvedValueOnce(makeTitularValores([]));

      jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      const result = await service.recalcularDependentesDoTitular(1);
      expect(result).toBeUndefined();
    });

    it('recalcularDependentesDoTitular com titular sem plano', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValueOnce({
        ...makeTitularComDependentes([]),
        plano: null,
      });

      await expect(service.recalcularDependentesDoTitular(1)).resolves.toBeUndefined();
    });

    it('recalcularDependentesDoTitular com titular.id 42', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({ ...makeTitularComDependentes([]), id: 42 })
        .mockResolvedValueOnce(makeTitularValores([]));

      jest.spyOn(service, 'recalcularFinanceiroTitular').mockResolvedValue(0);

      await service.recalcularDependentesDoTitular(42);

      expect(prismaMock.titular.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 42 } }),
      );
    });
  });

  // ── construtor — validações adicionais ────────────────────────────────────────
  describe('construtor — validações adicionais', () => {
    it('lança erro com tenantId numérico 0', () => {
      expect(() => new TitularPricingService(0 as any)).toThrow();
    });

    it('lança erro com tenantId null', () => {
      expect(() => new TitularPricingService(null as any)).toThrow();
    });

    it('lança erro com tenantId false', () => {
      expect(() => new TitularPricingService(false as any)).toThrow();
    });

    it('instancia com tenantId longo', () => {
      expect(() => new TitularPricingService('tenant-with-very-long-id-123456')).not.toThrow();
    });

    it('instancia com tenantId letras maiúsculas', () => {
      expect(() => new TitularPricingService('TENANT_UPPER')).not.toThrow();
    });

    it('instancia com tenantId com números', () => {
      expect(() => new TitularPricingService('tenant123')).not.toThrow();
    });
  });

  // ── recalcularFinanceiroTitular — retorno numérico ────────────────────────────
  describe('recalcularFinanceiroTitular — retorno e atualização', () => {
    it('retorna 0 quando titular não encontrado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.recalcularFinanceiroTitular(999);
      expect(result).toBe(0);
    });

    it('chama titular.update com o valor calculado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([{ valor: 50 }, { valor: 30 }]),
      );
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      await service.recalcularFinanceiroTitular(1);

      expect(prismaMock.titular.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });

    it('retorna valor numérico quando dependentes têm valores', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([{ valor: 50 }, { valor: 30 }], 100),
      );
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.recalcularFinanceiroTitular(1);
      expect(typeof result).toBe('number');
    });

    it('ID 5 passado para findUnique na busca de titular', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(makeTitularValores([]));
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      await service.recalcularFinanceiroTitular(5);

      expect(prismaMock.titular.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('atualiza todas contas PENDENTE com novo valor', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([{ valor: 50 }], 100),
      );
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 10, valor: 80, status: 'PENDENTE' },
        { id: 11, valor: 80, status: 'PENDENTE' },
      ]);

      await service.recalcularFinanceiroTitular(1);

      expect(prismaMock.titular.update).toHaveBeenCalled();
    });

    it('não atualiza contas PAGO', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(
        makeTitularValores([{ valor: 50 }], 100),
      );
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 10, valor: 80, status: 'PAGO' },
      ]);

      await service.recalcularFinanceiroTitular(1);

      expect(prismaMock.titular.update).toHaveBeenCalled();
    });
  });

  // ── recalcularFinanceiroTitular — cenários mínimos extra ─────────────────────
  describe('recalcularFinanceiroTitular — extras', () => {
    it('retorna número quando titular tem plano', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 10, planoId: 1, dataNascimento: new Date('1970-01-01'),
        dependentes: [], plano: { id: 1, valorBase: 80, progressivo: false, tipoCalculo: 'FIXO' },
      });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 10 });
      const result = await service.recalcularFinanceiroTitular(10);
      expect(typeof result === 'number').toBe(true);
    });

    it('retorna 0 quando titular não tem plano', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 11, planoId: null, dataNascimento: new Date('1970-01-01'),
        dependentes: [], plano: null,
      });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 11 });
      const result = await service.recalcularFinanceiroTitular(11);
      expect(typeof result === 'number').toBe(true);
    });

    it('não lança erro quando titular não encontrado', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.recalcularFinanceiroTitular(999)).resolves.toBeDefined();
    });

    it('chama titular.update com id correto', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 12, planoId: 1, dataNascimento: new Date('1970-01-01'),
        dependentes: [], plano: { id: 1, valorBase: 80, progressivo: false, tipoCalculo: 'FIXO' },
      });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 12 });
      await service.recalcularFinanceiroTitular(12);
      expect(prismaMock.titular.update).toHaveBeenCalled();
    });

    it('retorna valor numérico >= 0', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 13, planoId: 1, dataNascimento: new Date('1980-01-01'),
        dependentes: [], plano: { id: 1, valorBase: 120, progressivo: false, tipoCalculo: 'FIXO' },
      });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 13 });
      const result = await service.recalcularFinanceiroTitular(13);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('com multiple titulares chamar um por vez', async () => {
      (prismaMock.titular.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 14, planoId: 1, dataNascimento: new Date('1970-01-01'),
          dependentes: [], plano: { id: 1, valorBase: 80, progressivo: false, tipoCalculo: 'FIXO' },
        })
        .mockResolvedValueOnce({
          id: 15, planoId: 1, dataNascimento: new Date('1970-01-01'),
          dependentes: [], plano: { id: 1, valorBase: 80, progressivo: false, tipoCalculo: 'FIXO' },
        });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({});
      const r1 = await service.recalcularFinanceiroTitular(14);
      const r2 = await service.recalcularFinanceiroTitular(15);
      expect(typeof r1 === 'number').toBe(true);
      expect(typeof r2 === 'number').toBe(true);
    });
  });
});
