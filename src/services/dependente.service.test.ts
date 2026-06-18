const prismaMock = {
  businessRules: {
    findFirst: jest.fn(),
  },
  dependente: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  titular: {
    findUnique: jest.fn(),
  },
};

const pricingServiceMock = {
  recalcularDependentesDoTitular: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

jest.mock('./titular-pricing.service', () => ({
  TitularPricingService: jest.fn().mockImplementation(() => pricingServiceMock),
}));

import { DependenteService } from './dependente.service';

describe('DependenteService', () => {
  let service: DependenteService;

  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
      nome: 'Titular Teste',
      cpf: '12345678901',
      corresponsaveis: [],
    });
    service = new DependenteService('tenant-123');
  });

  it('cria dependente normalizando datas e recalculando tarifação do titular', async () => {
    (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
      limiteBeneficiarios: 5,
    });
    (prismaMock.dependente.count as jest.Mock).mockResolvedValue(2);
    (prismaMock.dependente.create as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 11,
      ...data,
    }));

    const result = await service.create({
      titularId: 9,
      nome: 'Dependente Novo',
      tipoDependente: 'Filho(a)',
      dataNascimento: '2015-01-10',
      carenciaInicioEm: '2026-06-18',
    } as any);

    expect(prismaMock.dependente.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        titularId: 9,
        nome: 'Dependente Novo',
        dataNascimento: new Date('2015-01-10T00:00:00.000Z'),
        carenciaInicioEm: new Date('2026-06-18T00:00:00.000Z'),
      }),
    });
    expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(9);
    expect(result).toEqual(
      expect.objectContaining({
        id: 11,
        titularId: 9,
      }),
    );
  });

  it('usa a data atual como carência quando ela não é informada', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-18T13:00:00.000Z'));
    (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
      limiteBeneficiarios: null,
    });
    (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 12 });

    await service.create({
      titularId: 4,
      nome: 'Sem Carência Informada',
      tipoDependente: 'Filho(a)',
      dataNascimento: '2014-02-02',
    } as any);

    expect(prismaMock.dependente.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        carenciaInicioEm: new Date('2026-06-18T13:00:00.000Z'),
      }),
    });
    jest.useRealTimers();
  });

  it('bloqueia criação quando o limite de beneficiários é excedido', async () => {
    (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
      limiteBeneficiarios: 2,
    });
    (prismaMock.dependente.count as jest.Mock).mockResolvedValue(2);

    await expect(
      service.create({
        titularId: 3,
        nome: 'Excedente',
        tipoDependente: 'Filho(a)',
        dataNascimento: '2018-01-01',
      } as any),
    ).rejects.toMatchObject({
      status: 400,
      code: 'LIMITE_BENEFICIARIOS_EXCEDIDO',
      meta: expect.objectContaining({
        limiteBeneficiarios: 2,
        totalDependentes: 2,
      }),
    });

    expect(prismaMock.dependente.create).not.toHaveBeenCalled();
  });

  it('bloqueia criação quando o corresponsável já consome uma vaga da grade', async () => {
    (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
      limiteBeneficiarios: 2,
    });
    (prismaMock.dependente.count as jest.Mock).mockResolvedValue(1);
    (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
      nome: 'Titular Teste',
      cpf: '12345678901',
      corresponsaveis: [
        {
          nome: 'Corresponsável Teste',
          cpf: '22233344455',
          relacionamento: 'Cônjuge',
        },
      ],
    });

    await expect(
      service.create({
        titularId: 3,
        nome: 'Excedente Com Corresponsável',
        tipoDependente: 'Filho(a)',
        dataNascimento: '2018-01-01',
      } as any),
    ).rejects.toMatchObject({
      status: 400,
      code: 'LIMITE_BENEFICIARIOS_EXCEDIDO',
      meta: expect.objectContaining({
        limiteBeneficiarios: 2,
        totalDependentes: 2,
      }),
    });

    expect(prismaMock.dependente.create).not.toHaveBeenCalled();
  });

  it('rejeita create com titularId inválido', async () => {
    await expect(
      service.create({
        titularId: 0,
        nome: 'Inválido',
        tipoDependente: 'Filho(a)',
        dataNascimento: '2018-01-01',
      } as any),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejeita create com dataNascimento inválida', async () => {
    await expect(
      service.create({
        titularId: 1,
        nome: 'Data Ruim',
        tipoDependente: 'Filho(a)',
        dataNascimento: 'nao-e-data',
      } as any),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('atualiza dependente, normaliza data via set e recalcula para o titular novo', async () => {
    (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({
      id: 10,
      titularId: 1,
    });
    (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
      limiteBeneficiarios: 8,
    });
    (prismaMock.dependente.count as jest.Mock).mockResolvedValue(3);
    (prismaMock.dependente.update as jest.Mock).mockImplementation(async ({ data }) => ({
      id: 10,
      ...data,
    }));

    await service.update(10, {
      titularId: 2,
      dataNascimento: { set: '2017-05-20' },
    } as any);

    expect(prismaMock.dependente.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        titularId: 2,
        dataNascimento: { set: new Date('2017-05-20T00:00:00.000Z') },
      },
    });
    expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(2);
  });

  it('retorna 404 ao atualizar dependente inexistente', async () => {
    (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.update(999, { nome: 'Nada' } as any)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('apaga dependente e recalcula quando há titular associado', async () => {
    (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({
      titularId: 6,
    });
    (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({
      id: 21,
    });

    const result = await service.delete(21);

    expect(prismaMock.dependente.delete).toHaveBeenCalledWith({
      where: { id: 21 },
    });
    expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(6);
    expect(result).toEqual({ id: 21 });
  });
});
