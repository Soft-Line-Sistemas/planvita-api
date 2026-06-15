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

describe('TitularPricingService', () => {
  let service: TitularPricingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TitularPricingService('tenant-123');
  });

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
        plano: {
          beneficiarios: [{ nome: 'Filho(a)' }],
        },
        dependentes: [
          {
            id: 11,
            nome: 'Dependente 60',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('1966-06-15T00:00:00.000Z'),
            excluirCobrancaAdicional: false,
          },
          {
            id: 12,
            nome: 'Dependente 61',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('1965-06-14T00:00:00.000Z'),
            excluirCobrancaAdicional: false,
          },
          {
            id: 13,
            nome: 'Dependente 81',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('1945-01-01T00:00:00.000Z'),
            excluirCobrancaAdicional: false,
          },
          {
            id: 14,
            nome: 'Dependente Na Grade',
            tipoDependente: 'Filho(a)',
            dataNascimento: new Date('2015-01-01T00:00:00.000Z'),
            excluirCobrancaAdicional: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 1,
        plano: {
          valorMensal: 100,
        },
        servicosAdicionaisJson: null,
        dependentes: [
          { valorAdicionalMensal: 9.9 },
          { valorAdicionalMensal: 19.9 },
          { valorAdicionalMensal: 49 },
          { valorAdicionalMensal: 0 },
        ],
      });

    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

    await service.recalcularDependentesDoTitular(1);

    expect(prismaMock.dependente.update).toHaveBeenCalledTimes(4);
    expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 11 },
        data: expect.objectContaining({
          foraGradeFamiliar: true,
          valorAdicionalMensal: 9.9,
        }),
      }),
    );
    expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 12 },
        data: expect.objectContaining({
          foraGradeFamiliar: true,
          valorAdicionalMensal: 19.9,
        }),
      }),
    );
    expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: { id: 13 },
        data: expect.objectContaining({
          foraGradeFamiliar: true,
          valorAdicionalMensal: 49,
        }),
      }),
    );
    expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        where: { id: 14 },
        data: expect.objectContaining({
          foraGradeFamiliar: false,
          valorAdicionalMensal: 0,
        }),
      }),
    );

    expect(prismaMock.titular.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        valorTotalContrato: 178.8,
      },
    });
  });

  it('bloqueia tarifação progressiva quando dependente adicional não possui data válida', async () => {
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
      plano: {
        beneficiarios: [{ nome: 'Filho(a)' }],
      },
      dependentes: [
        {
          id: 99,
          nome: 'Dependente Inválido',
          tipoDependente: 'Sobrinho(a)',
          dataNascimento: new Date('invalid'),
          excluirCobrancaAdicional: false,
        },
      ],
    });

    await expect(service.recalcularDependentesDoTitular(1)).rejects.toMatchObject({
      status: 400,
      code: 'DEPENDENTE_DATA_NASCIMENTO_INVALIDA',
    });

    expect(prismaMock.dependente.update).not.toHaveBeenCalled();
    expect(prismaMock.titular.update).not.toHaveBeenCalled();
  });
});
