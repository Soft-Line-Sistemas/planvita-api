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

  it('usa valor fixo (flat) como fallback quando não há faixas JSON configuradas', async () => {
    // plano com beneficiários definidos → sobrinho fica fora da grade
    (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
      valorAdicionalDependenteForaGradeFaixasJson: null,
      valorAdicionalDependenteForaGrade: 14.9,
    });

    (prismaMock.titular.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 1,
        plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
        dependentes: [
          {
            id: 20,
            nome: 'Sobrinho Fora',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('1990-01-01T00:00:00.000Z'),
            excluirCobrancaAdicional: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 1,
        plano: { valorMensal: 100 },
        servicosAdicionaisJson: null,
        dependentes: [{ valorAdicionalMensal: 14.9 }],
      });

    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

    await service.recalcularDependentesDoTitular(1);

    expect(prismaMock.dependente.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 20 },
        data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 14.9 }),
      }),
    );

    expect(prismaMock.titular.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { valorTotalContrato: 114.9 },
    });
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
          {
            id: 21,
            nome: 'Primo Fora',
            tipoDependente: 'Primo(a)',
            dataNascimento: new Date('1985-03-10T00:00:00.000Z'),
            excluirCobrancaAdicional: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 1,
        plano: { valorMensal: 50 },
        servicosAdicionaisJson: null,
        dependentes: [{ valorAdicionalMensal: 22.5 }],
      });

    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

    await service.recalcularDependentesDoTitular(1);

    expect(prismaMock.dependente.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 22.5 }),
      }),
    );
  });

  it('usa JSON de faixas salvo pela UI (formato exato enviado pelo frontend)', async () => {
    // handleSave() do frontend serializa as faixas com JSON.stringify e envia no campo
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
          {
            id: 30,
            nome: 'Jovem',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('2000-01-01T00:00:00.000Z'), // ~26 anos → faixa até 30 → R$ 5,90
            excluirCobrancaAdicional: false,
          },
          {
            id: 31,
            nome: 'Meia Idade',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('1970-06-01T00:00:00.000Z'), // ~55 anos → faixa até 59 → R$ 14,90
            excluirCobrancaAdicional: false,
          },
          {
            id: 32,
            nome: 'Idoso',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('1950-01-01T00:00:00.000Z'), // ~76 anos → acima de 69 → R$ 39,90
            excluirCobrancaAdicional: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 2,
        plano: { valorMensal: 80 },
        servicosAdicionaisJson: null,
        dependentes: [
          { valorAdicionalMensal: 5.9 },
          { valorAdicionalMensal: 14.9 },
          { valorAdicionalMensal: 39.9 },
        ],
      });

    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

    await service.recalcularDependentesDoTitular(2);

    expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ data: expect.objectContaining({ valorAdicionalMensal: 5.9 }) }),
    );
    expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ data: expect.objectContaining({ valorAdicionalMensal: 14.9 }) }),
    );
    expect(prismaMock.dependente.update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ data: expect.objectContaining({ valorAdicionalMensal: 39.9 }) }),
    );

    // 80 + 5.9 + 14.9 + 39.9 = 140.7
    expect(prismaMock.titular.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { valorTotalContrato: 140.7 },
    });
  });

  it('dependente com excluirCobrancaAdicional=true paga zero mesmo fora da grade', async () => {
    (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
      valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([
        { idadeMaxima: null, valor: 49 },
      ]),
      valorAdicionalDependenteForaGrade: 14.9,
    });

    (prismaMock.titular.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 3,
        plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
        dependentes: [
          {
            id: 40,
            nome: 'Isento',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('1960-01-01T00:00:00.000Z'),
            excluirCobrancaAdicional: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 3,
        plano: { valorMensal: 100 },
        servicosAdicionaisJson: null,
        dependentes: [{ valorAdicionalMensal: 0 }],
      });

    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

    await service.recalcularDependentesDoTitular(3);

    expect(prismaMock.dependente.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 0 }),
      }),
    );

    expect(prismaMock.titular.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { valorTotalContrato: 100 },
    });
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
          {
            id: 50,
            nome: 'Primo Fora',
            tipoDependente: 'Primo(a)',
            dataNascimento: new Date('1975-05-05T00:00:00.000Z'),
            excluirCobrancaAdicional: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 4,
        plano: { valorMensal: 100 },
        servicosAdicionaisJson: null,
        dependentes: [{ valorAdicionalMensal: 18.5 }],
      });

    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

    await service.recalcularDependentesDoTitular(4);

    expect(prismaMock.dependente.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ foraGradeFamiliar: true, valorAdicionalMensal: 18.5 }),
      }),
    );
  });

  it('plano sem beneficiários definidos trata todos como dentro da grade (sem cobrança)', async () => {
    // Comportamento documentado: lista vazia = sem grade definida = sem cobrança adicional
    (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
      valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([
        { idadeMaxima: null, valor: 49 },
      ]),
      valorAdicionalDependenteForaGrade: 14.9,
    });

    (prismaMock.titular.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 6,
        plano: { beneficiarios: [] },
        dependentes: [
          {
            id: 70,
            nome: 'Sobrinho',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('1980-01-01T00:00:00.000Z'),
            excluirCobrancaAdicional: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 6,
        plano: { valorMensal: 100 },
        servicosAdicionaisJson: null,
        dependentes: [{ valorAdicionalMensal: 0 }],
      });

    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

    await service.recalcularDependentesDoTitular(6);

    expect(prismaMock.dependente.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ foraGradeFamiliar: false, valorAdicionalMensal: 0 }),
      }),
    );

    expect(prismaMock.titular.update).toHaveBeenCalledWith({
      where: { id: 6 },
      data: { valorTotalContrato: 100 },
    });
  });

  it('atualiza conta a receber aberta no Asaas com novo valor quando faixa muda', async () => {
    (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
      valorAdicionalDependenteForaGradeFaixasJson: JSON.stringify([
        { idadeMaxima: null, valor: 30 },
      ]),
      valorAdicionalDependenteForaGrade: 14.9,
    });

    (prismaMock.titular.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: 5,
        plano: { beneficiarios: [{ nome: 'Filho(a)' }] },
        dependentes: [
          {
            id: 60,
            nome: 'Sobrinho Fora',
            tipoDependente: 'Sobrinho(a)',
            dataNascimento: new Date('1980-01-01T00:00:00.000Z'),
            excluirCobrancaAdicional: false,
          },
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

    expect(prismaMock.contaReceber.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { valor: 130 },
    });

    expect(mockAsaasIntegration.updatePaymentForContaReceber).toHaveBeenCalledWith(
      99,
      { value: 130 },
    );
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
