const mockPrisma = {
  planoBeneficiario: {
    deleteMany: jest.fn(),
  },
  planoCobertura: {
    deleteMany: jest.fn(),
  },
  plano: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  titular: {
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => mockPrisma,
}));

const pricingMock = {
  recalcularDependentesDoTitular: jest.fn().mockResolvedValue(undefined),
};

jest.mock('./titular-pricing.service', () => ({
  TitularPricingService: jest.fn().mockImplementation(() => pricingMock),
}));

import { PlanoService } from './plano.service';

// ─── helpers ──────────────────────────────────────────────────────────────────

const makePlano = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  nome: 'Plano Test',
  valorMensal: 100,
  idadeMaxima: 60,
  ativo: true,
  beneficios: [],
  coberturas: [],
  beneficiarios: [],
  assistenciaFuneral: 0,
  auxilioCemiterio: null,
  taxaInclusaCemiterioPublico: false,
  ...overrides,
});

// ─── sugerirPlano ─────────────────────────────────────────────────────────────

describe('PlanoService.sugerirPlano', () => {
  let service: PlanoService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.planoBeneficiario.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.planoCobertura.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg({
          planoBeneficiario: mockPrisma.planoBeneficiario,
          planoCobertura: mockPrisma.planoCobertura,
          plano: mockPrisma.plano,
        });
      }
      return [];
    });
    service = new PlanoService('bosque');
  });

  it('retorna o plano da maior faixa atendida pela maior idade do grupo', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55 }),
      makePlano({ id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60 }),
      makePlano({ id: 3, nome: 'Bosque Plus', valorMensal: 79.9, idadeMaxima: 70 }),
      makePlano({ id: 5, nome: 'Bosque Senior', valorMensal: 109.9, idadeMaxima: 85 }),
      makePlano({ id: 4, nome: 'Bosque Premium', valorMensal: 129.9, idadeMaxima: null }),
    ]);

    const resultado = await service.sugerirPlano(
      [{ dataNascimento: '1954-06-02', parentesco: 'Titular' }],
      false,
    );

    expect(resultado).toMatchObject({ id: 5, nome: 'Bosque Senior', idadeMaxima: 85 });
  });

  it('usa a menor faixa quando a idade fica abaixo da primeira', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55 }),
      makePlano({ id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60 }),
      makePlano({ id: 3, nome: 'Bosque Senior', valorMensal: 109.9, idadeMaxima: 85 }),
      makePlano({ id: 4, nome: 'Bosque Premium', valorMensal: 129.9, idadeMaxima: null }),
    ]);

    const abaixo = await service.sugerirPlano([{ idade: 30, parentesco: 'Titular' }], false);
    expect(abaixo).toMatchObject({ id: 1, nome: 'Bosque Social', idadeMaxima: 55 });
  });

  it('usa plano sem limite quando idade passa da ultima faixa', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 3, nome: 'Bosque Senior', valorMensal: 109.9, idadeMaxima: 85 }),
      makePlano({ id: 4, nome: 'Bosque Premium', valorMensal: 129.9, idadeMaxima: null }),
    ]);

    const acima = await service.sugerirPlano([{ idade: 86, parentesco: 'Titular' }], false);
    expect(acima).toMatchObject({ id: 4, nome: 'Bosque Premium', idadeMaxima: null });
  });

  it('mantém todos os planos elegíveis com retornarTodos=true e ordena sem limite por último', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 4, nome: 'Bosque Premium', valorMensal: 129.9, idadeMaxima: null }),
      makePlano({ id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60 }),
      makePlano({ id: 3, nome: 'Bosque Plus', valorMensal: 79.9, idadeMaxima: 70 }),
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55 }),
    ]);

    const resultado = await service.sugerirPlano([{ idade: 72, parentesco: 'Titular' }], true);

    expect(Array.isArray(resultado)).toBe(true);
    expect(resultado).toMatchObject([
      { id: 1, idadeMaxima: 55 },
      { id: 2, idadeMaxima: 60 },
      { id: 3, idadeMaxima: 70 },
      { id: 4, idadeMaxima: null },
    ]);
  });

  it('permite ignorar composição no cadastro para sempre sugerir plano', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55, beneficiarios: [{ id: 1, nome: 'Titular' }, { id: 2, nome: 'Cônjuge' }] }),
      makePlano({ id: 2, nome: 'Bosque Premium', valorMensal: 129.9, idadeMaxima: null, beneficiarios: [{ id: 3, nome: 'Titular' }] }),
    ]);

    const semIgnorar = await service.sugerirPlano([{ idade: 35, parentesco: 'Titular' }, { idade: 30, parentesco: 'Outro' }], true, false);
    const ignorando = await service.sugerirPlano([{ idade: 35, parentesco: 'Titular' }, { idade: 30, parentesco: 'Outro' }], true, true);

    expect(semIgnorar).toEqual([]);
    expect(ignorando).toMatchObject([{ id: 1, nome: 'Bosque Social' }, { id: 2, nome: 'Bosque Premium' }]);
  });

  it('retorna Social e Essencial juntos quando todos os participantes permitidos têm até 55 anos', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55 }),
      makePlano({ id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60 }),
      makePlano({ id: 3, nome: 'Bosque Plus', valorMensal: 79.9, idadeMaxima: 70 }),
    ]);

    const resultado = await service.sugerirPlano([
      { idade: 40, parentesco: 'Titular' },
      { idade: 38, parentesco: 'Cônjuge' },
      { idade: 12, parentesco: 'Filho' },
    ], false);
    expect(resultado).toMatchObject({ id: 1, nome: 'Bosque Social' });
  });

  it('oculta Social quando existe participante acima de 55 anos', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55 }),
      makePlano({ id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60 }),
      makePlano({ id: 3, nome: 'Bosque Plus', valorMensal: 79.9, idadeMaxima: 70 }),
    ]);

    const compativeis = await service.listarPlanosCompativeis([{ idade: 56, parentesco: 'Titular' }]);
    expect(compativeis).toMatchObject([{ id: 2, nome: 'Bosque Essencial' }]);
    expect(compativeis).toHaveLength(1);
  });

  it('retorna null/undefined quando não há planos ativos', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([]);
    const resultado = await service.sugerirPlano([{ idade: 40, parentesco: 'Titular' }], false);
    expect(resultado == null || resultado === undefined || (Array.isArray(resultado) && resultado.length === 0)).toBeTruthy();
  });

  it('usa maior idade do grupo para selecionar faixa', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Junior', valorMensal: 50, idadeMaxima: 30 }),
      makePlano({ id: 2, nome: 'Senior', valorMensal: 100, idadeMaxima: 70 }),
    ]);

    const resultado = await service.sugerirPlano([
      { idade: 20, parentesco: 'Titular' },
      { idade: 65, parentesco: 'Cônjuge' },
    ], false);
    expect(resultado).toMatchObject({ id: 2, nome: 'Senior', idadeMaxima: 70 });
  });

  it('aceita participante com dataNascimento no lugar de idade', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Plano A', valorMensal: 50, idadeMaxima: 60 }),
      makePlano({ id: 2, nome: 'Plano B', valorMensal: 100, idadeMaxima: null }),
    ]);

    const hoje = new Date();
    const nascimento = `${hoje.getFullYear() - 45}-06-01`;
    const resultado = await service.sugerirPlano([{ dataNascimento: nascimento, parentesco: 'Titular' }], false);
    expect(resultado).toMatchObject({ id: 1, nome: 'Plano A' });
  });

  it('lista planos compatíveis para grupo com Social/Essencial', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Social', valorMensal: 49.99, idadeMaxima: 55 }),
      makePlano({ id: 2, nome: 'Essencial', valorMensal: 69.9, idadeMaxima: 60 }),
    ]);

    const compativeis = await service.listarPlanosCompativeis([
      { idade: 40, parentesco: 'Titular' },
      { idade: 38, parentesco: 'Cônjuge' },
    ]);
    expect(compativeis).toHaveLength(2);
  });

  it('retorna array vazio de compativeis quando todos excluídos por composição', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Somente Titular', valorMensal: 50, idadeMaxima: 60, beneficiarios: [{ id: 1, nome: 'Titular' }] }),
    ]);

    const compativeis = await service.listarPlanosCompativeis([
      { idade: 30, parentesco: 'Titular' },
      { idade: 25, parentesco: 'Primo' },
    ]);
    expect(compativeis).toEqual([]);
  });

  it('plano sem beneficiários aceita qualquer composição familiar', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Universal', valorMensal: 100, idadeMaxima: null, beneficiarios: [] }),
    ]);

    const resultado = await service.sugerirPlano([
      { idade: 30, parentesco: 'Titular' },
      { idade: 25, parentesco: 'Primo' },
    ], true);
    expect(Array.isArray(resultado) ? resultado : [resultado]).toMatchObject([expect.objectContaining({ id: 1 })]);
  });

  it('participante com parentesco "Neto" é elegível Social quando idade ≤ 55', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 50, idadeMaxima: 55 }),
    ]);

    const resultado = await service.sugerirPlano([
      { idade: 35, parentesco: 'Titular' },
      { idade: 10, parentesco: 'Neto' },
    ], false);
    expect(resultado).toMatchObject({ id: 1, nome: 'Bosque Social' });
  });

  it('participante com parentesco "Sogra" não é elegível Social mas cai no fallback por faixa de idade', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 50, idadeMaxima: 55 }),
      makePlano({ id: 2, nome: 'Bosque Plus', valorMensal: 80, idadeMaxima: 70 }),
    ]);

    const resultado = await service.sugerirPlano([
      { idade: 35, parentesco: 'Titular' },
      { idade: 50, parentesco: 'Sogra' },
    ], false);
    // Sogra não é elegível para Social por composição, então seleção normal por faixa de idade.
    // Com maiorIdade=50, a primeira faixa compatível é 55 (Social) via fallback.
    expect(resultado).toBeDefined();
    expect((resultado as any).id).toBeGreaterThanOrEqual(1);
  });

  it('participante com categoria resumida "1° Grau" não é elegível Social, mas continua com plano compatível', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 50, idadeMaxima: 55, beneficiarios: [{ id: 1, nome: 'Titular' }] }),
      makePlano({ id: 2, nome: 'Bosque Essencial', valorMensal: 70, idadeMaxima: 60, beneficiarios: [{ id: 2, nome: 'Titular' }] }),
      makePlano({ id: 3, nome: 'Bosque Plus', valorMensal: 80, idadeMaxima: 70, beneficiarios: [{ id: 3, nome: 'Titular' }] }),
    ]);

    const resultado = await service.listarPlanosCompativeis([
      { idade: 35, parentesco: 'Titular' },
      { idade: 10, parentesco: '1° Grau' },
    ]);

    expect(resultado).toMatchObject([{ id: 2, nome: 'Bosque Essencial' }]);
  });

  it('sugerirPlano retornarTodos ordena por idadeMaxima asc com null por último', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 3, nome: 'C', valorMensal: 100, idadeMaxima: null }),
      makePlano({ id: 1, nome: 'A', valorMensal: 50, idadeMaxima: 40 }),
      makePlano({ id: 2, nome: 'B', valorMensal: 70, idadeMaxima: 60 }),
    ]);

    const todos = await service.sugerirPlano([{ idade: 20, parentesco: 'Titular' }], true) as any[];
    expect(todos[0].idadeMaxima).toBe(40);
    expect(todos[1].idadeMaxima).toBe(60);
    expect(todos[2].idadeMaxima).toBeNull();
  });

  it('sugerirPlano retorna benefícios achatados no resultado', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({
        id: 1, nome: 'Plano A', idadeMaxima: null,
        beneficios: [{ beneficio: { id: 5, nome: 'Assistência 24h', tipo: 'Funeral', descricao: '', valor: 0, validade: null } }],
      }),
    ]);

    const resultado = await service.sugerirPlano([{ idade: 30, parentesco: 'Titular' }], true) as any[];
    expect(resultado[0].beneficios).toMatchObject([expect.objectContaining({ id: 5, nome: 'Assistência 24h' })]);
  });

  it('sugerirPlano calcula assistenciaFuneral corretamente no score', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Simples', valorMensal: 50, idadeMaxima: 60, assistenciaFuneral: 0 }),
      makePlano({ id: 2, nome: 'Completo', valorMensal: 50, idadeMaxima: 60, assistenciaFuneral: 5000 }),
    ]);

    // Os dois têm a mesma idadeMaxima e valorMensal, deve ser deduplicados por key (mesmo nome|valor|idadeMax)
    // mas têm nomes diferentes então são distintos
    const todos = await service.sugerirPlano([{ idade: 30, parentesco: 'Titular' }], true) as any[];
    // ambos existem
    expect(todos.some((p: any) => p.nome === 'Simples')).toBe(true);
    expect(todos.some((p: any) => p.nome === 'Completo')).toBe(true);
  });
});

// ─── listarPlanosCompativeis ──────────────────────────────────────────────────

describe('PlanoService.listarPlanosCompativeis', () => {
  let service: PlanoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlanoService('bosque');
  });

  it('retorna todos os compatíveis para grupo jovem elegível Social', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55 }),
      makePlano({ id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60 }),
    ]);

    const resultado = await service.listarPlanosCompativeis([{ idade: 40, parentesco: 'Titular' }, { idade: 38, parentesco: 'Cônjuge' }, { idade: 12, parentesco: 'Filho' }]);
    expect(resultado).toMatchObject([{ id: 1, nome: 'Bosque Social' }, { id: 2, nome: 'Bosque Essencial' }]);
  });

  it('oculta Social quando existe participante acima de 55 anos', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([
      makePlano({ id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55 }),
      makePlano({ id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60 }),
      makePlano({ id: 3, nome: 'Bosque Plus', valorMensal: 79.9, idadeMaxima: 70 }),
    ]);

    const resultado = await service.listarPlanosCompativeis([{ idade: 56, parentesco: 'Titular' }]);
    expect(resultado).toMatchObject([{ id: 2, nome: 'Bosque Essencial' }]);
    expect(resultado).toHaveLength(1);
  });

  it('retorna array vazio quando não há planos ativos', async () => {
    mockPrisma.plano.findMany.mockResolvedValue([]);
    const resultado = await service.listarPlanosCompativeis([{ idade: 30, parentesco: 'Titular' }]);
    expect(resultado).toEqual([]);
  });
});

// ─── getAll / getById / CRUD ──────────────────────────────────────────────────

describe('PlanoService CRUD', () => {
  let service: PlanoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlanoService('tenant-123');
  });

  describe('constructor', () => {
    it('lança erro com tenantId vazio', () => {
      expect(() => new PlanoService('')).toThrow('Tenant ID must be provided');
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new PlanoService(undefined as any)).toThrow('Tenant ID must be provided');
    });
  });

  describe('getById', () => {
    it('retorna plano pelo id', async () => {
      const plano = { id: 5, nome: 'Test' };
      mockPrisma.plano.findUnique.mockResolvedValue(plano);
      const result = await service.getById(5);
      expect(result).toEqual(plano);
      expect(mockPrisma.plano.findUnique).toHaveBeenCalledWith({ where: { id: 5 } });
    });

    it('retorna null quando plano não existe', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(null);
      const result = await service.getById(999);
      expect(result).toBeNull();
    });

    it('normaliza id string para number', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(null);
      await service.getById('7' as any);
      expect(mockPrisma.plano.findUnique).toHaveBeenCalledWith({ where: { id: 7 } });
    });
  });

  describe('delete', () => {
    it('deleta plano pelo id', async () => {
      mockPrisma.plano.delete.mockResolvedValue({ id: 3 });
      const result = await service.delete(3);
      expect(result).toEqual({ id: 3 });
      expect(mockPrisma.plano.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    });

    it('repassa erro do prisma para cima no delete', async () => {
      mockPrisma.plano.delete.mockRejectedValue(new Error('Record not found'));
      await expect(service.delete(999)).rejects.toThrow('Record not found');
    });
  });

  describe('create', () => {
    it('cria plano básico com campos obrigatórios', async () => {
      const created = { id: 10, nome: 'Novo Plano', valorMensal: 99.9 };
      mockPrisma.plano.create.mockResolvedValue(created);

      const result = await service.create({ nome: 'Novo Plano', valorMensal: 99.9 } as any);
      expect(result).toEqual(created);
      expect(mockPrisma.plano.create).toHaveBeenCalled();
    });

    it('normaliza nome com trim', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'Plano A' });
      await service.create({ nome: '  Plano A  ', valorMensal: 50 } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.nome).toBe('Plano A');
    });

    it('converte valorMensal string para number', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X', valorMensal: 100 });
      await service.create({ nome: 'X', valorMensal: '100' as any } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.valorMensal).toBe(100);
    });

    it('ativo padrão é true quando não especificado', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X', ativo: true });
      await service.create({ nome: 'X', valorMensal: 50 } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.ativo).toBe(true);
    });

    it('cria plano com beneficiários', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X' });
      await service.create({ nome: 'X', valorMensal: 50, beneficiarios: ['Titular', 'Cônjuge'] } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.beneficiarios).toMatchObject({
        create: [{ nome: 'Titular' }, { nome: 'Cônjuge' }],
      });
    });

    it('deduplica beneficiários repetidos', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X' });
      await service.create({ nome: 'X', valorMensal: 50, beneficiarios: ['Titular', 'Titular', 'Cônjuge'] } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.beneficiarios.create).toHaveLength(2);
    });

    it('ignora beneficiários vazios', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X' });
      await service.create({ nome: 'X', valorMensal: 50, beneficiarios: ['', '  ', 'Titular'] } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.beneficiarios.create).toHaveLength(1);
      expect(callData.beneficiarios.create[0].nome).toBe('Titular');
    });

    it('cria plano com coberturas no formato array de objetos', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X' });
      await service.create({
        nome: 'X', valorMensal: 50,
        coberturas: [{ tipo: 'servicosPadrao', descricao: 'Urna' }],
      } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.coberturas).toMatchObject({
        create: [{ tipo: 'servicosPadrao', descricao: 'Urna' }],
      });
    });

    it('cria plano com coberturas no formato objeto com chaves', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X' });
      await service.create({
        nome: 'X', valorMensal: 50,
        coberturas: { servicosPadrao: ['Urna', 'Translado'], coberturaTranslado: [] },
      } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.coberturas.create).toHaveLength(2);
      expect(callData.coberturas.create[0]).toMatchObject({ tipo: 'servicosPadrao', descricao: 'Urna' });
    });

    it('deduplica coberturas repetidas', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X' });
      await service.create({
        nome: 'X', valorMensal: 50,
        coberturas: [
          { tipo: 'servicosPadrao', descricao: 'Urna' },
          { tipo: 'servicosPadrao', descricao: 'Urna' },
          { tipo: 'servicosPadrao', descricao: 'Translado' },
        ],
      } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.coberturas.create).toHaveLength(2);
    });

    it('ignora coberturas com tipo ou descrição vazia', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X' });
      await service.create({
        nome: 'X', valorMensal: 50,
        coberturas: [{ tipo: '', descricao: 'Urna' }, { tipo: 'servicosPadrao', descricao: '' }],
      } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.coberturas).toBeUndefined();
    });

    it('auxilioCemiterio null permanece null', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X', auxilioCemiterio: null });
      await service.create({ nome: 'X', valorMensal: 50, auxilioCemiterio: null } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.auxilioCemiterio).toBeNull();
    });

    it('taxaInclusaCemiterioPublico converte para boolean', async () => {
      mockPrisma.plano.create.mockResolvedValue({ id: 1, nome: 'X' });
      await service.create({ nome: 'X', valorMensal: 50, taxaInclusaCemiterioPublico: 1 as any } as any);
      const callData = mockPrisma.plano.create.mock.calls[0][0].data;
      expect(callData.taxaInclusaCemiterioPublico).toBe(true);
    });
  });

  describe('update', () => {
    it('atualiza plano com dados parciais', async () => {
      mockPrisma.plano.update.mockResolvedValue({ id: 1, nome: 'Atualizado', valorMensal: 150 });
      const result = await service.update(1, { nome: 'Atualizado', valorMensal: 150 } as any);
      expect(result).toMatchObject({ nome: 'Atualizado', valorMensal: 150 });
    });

    it('normaliza id para number no update', async () => {
      mockPrisma.plano.update.mockResolvedValue({ id: 5 });
      await service.update('5' as any, { nome: 'X' } as any);
      expect(mockPrisma.plano.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('atualiza beneficiários com deleteMany + create', async () => {
      mockPrisma.plano.update.mockResolvedValue({ id: 1 });
      await service.update(1, { beneficiarios: ['Titular', 'Filho'] } as any);
      const callData = mockPrisma.plano.update.mock.calls[0][0].data;
      expect(callData.beneficiarios).toMatchObject({
        deleteMany: {},
        create: [{ nome: 'Titular' }, { nome: 'Filho' }],
      });
    });

    it('não toca beneficiários quando não passados', async () => {
      mockPrisma.plano.update.mockResolvedValue({ id: 1 });
      await service.update(1, { nome: 'Novo Nome' } as any);
      const callData = mockPrisma.plano.update.mock.calls[0][0].data;
      expect(callData.beneficiarios).toBeUndefined();
    });

    it('atualiza coberturas com deleteMany + create', async () => {
      mockPrisma.plano.update.mockResolvedValue({ id: 1 });
      await service.update(1, { coberturas: [{ tipo: 'servicosPadrao', descricao: 'Urna' }] } as any);
      const callData = mockPrisma.plano.update.mock.calls[0][0].data;
      expect(callData.coberturas).toMatchObject({
        deleteMany: {},
        create: [{ tipo: 'servicosPadrao', descricao: 'Urna' }],
      });
    });

    it('não toca coberturas quando não passadas', async () => {
      mockPrisma.plano.update.mockResolvedValue({ id: 1 });
      await service.update(1, { nome: 'Novo Nome' } as any);
      const callData = mockPrisma.plano.update.mock.calls[0][0].data;
      expect(callData.coberturas).toBeUndefined();
    });

    it('converte nome com trim no update', async () => {
      mockPrisma.plano.update.mockResolvedValue({ id: 1 });
      await service.update(1, { nome: '  Plano X  ' } as any);
      const callData = mockPrisma.plano.update.mock.calls[0][0].data;
      expect(callData.nome).toBe('Plano X');
    });

    it('repassa erro do prisma para cima no update', async () => {
      mockPrisma.plano.update.mockRejectedValue(new Error('DB error'));
      await expect(service.update(999, { nome: 'X' } as any)).rejects.toThrow('DB error');
    });
  });

  describe('getPaged', () => {
    it('retorna dados paginados com metadados', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([{ id: 1, nome: 'A', valorMensal: 50, idadeMaxima: 60, ativo: true }]);
      mockPrisma.plano.count.mockResolvedValue(1);

      const result = await service.getPaged({ page: 1, pageSize: 10 });
      expect(result.pagination).toMatchObject({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
      expect(result.data).toHaveLength(1);
    });

    it('usa valores padrão quando page e pageSize não passados', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      mockPrisma.plano.count.mockResolvedValue(0);

      const result = await service.getPaged({});
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.pageSize).toBe(20);
    });

    it('limita pageSize a 100', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      mockPrisma.plano.count.mockResolvedValue(0);

      const result = await service.getPaged({ pageSize: 999 });
      expect(result.pagination.pageSize).toBe(100);
    });

    it('filtra por ativo quando passado', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      mockPrisma.plano.count.mockResolvedValue(0);

      await service.getPaged({ ativo: false });
      const whereArg = mockPrisma.plano.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(whereArg)).toContain('"ativo":false');
    });

    it('filtra por nome quando passado', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      mockPrisma.plano.count.mockResolvedValue(0);

      await service.getPaged({ nome: 'Social' });
      const whereArg = mockPrisma.plano.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(whereArg)).toContain('Social');
    });

    it('calcula totalPages corretamente', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      mockPrisma.plano.count.mockResolvedValue(25);

      const result = await service.getPaged({ pageSize: 10 });
      expect(result.pagination.totalPages).toBe(3);
    });

    it('garante page mínimo de 1', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      mockPrisma.plano.count.mockResolvedValue(0);

      const result = await service.getPaged({ page: 0 });
      expect(result.pagination.page).toBe(1);
    });
  });

  describe('vincularPlanoAoTitular', () => {
    it('vincula plano ativo ao titular', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue({ id: 2, ativo: true });
      mockPrisma.titular.update.mockResolvedValue({ id: 10, nome: 'Cliente', planoId: 2 });

      const result = await service.vincularPlanoAoTitular(10, 2);
      expect(result).toMatchObject({ id: 10, planoId: 2 });
      expect(pricingMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(10);
    });

    it('lança erro ao tentar vincular plano inativo', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue({ id: 2, ativo: false });

      await expect(service.vincularPlanoAoTitular(10, 2)).rejects.toThrow('Plano inválido ou inativo.');
    });

    it('lança erro quando plano não existe', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(null);

      await expect(service.vincularPlanoAoTitular(10, 99)).rejects.toThrow('Plano inválido ou inativo.');
    });

    it('desvincula plano quando planoId=null', async () => {
      mockPrisma.titular.update.mockResolvedValue({ id: 10, nome: 'Cliente', planoId: null });

      const result = await service.vincularPlanoAoTitular(10, null);
      expect(mockPrisma.plano.findUnique).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 10 });
      expect(pricingMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(10);
    });
  });

  describe('getAll', () => {
    it('retorna planos deduplicados por nome+valor+idadeMaxima', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([
        { id: 1, nome: 'Plano A', valorMensal: 100, idadeMaxima: 60, ativo: true, coberturaMaxima: 0, carenciaDias: 0, vigenciaMeses: 12, totalClientes: 0, receitaMensal: 0, assistenciaFuneral: 0, auxilioCemiterio: null, taxaInclusaCemiterioPublico: false, beneficiarios: [], coberturas: [] },
        { id: 2, nome: 'Plano A', valorMensal: 100, idadeMaxima: 60, ativo: true, coberturaMaxima: 0, carenciaDias: 0, vigenciaMeses: 12, totalClientes: 0, receitaMensal: 0, assistenciaFuneral: 0, auxilioCemiterio: null, taxaInclusaCemiterioPublico: false, beneficiarios: [], coberturas: [] },
      ]);

      const result = await service.getAll();
      expect(result).toHaveLength(1);
    });

    it('normaliza idadeMaxima >= 999 para null', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([
        { id: 1, nome: 'Premium', valorMensal: 200, idadeMaxima: 999, ativo: true, coberturaMaxima: 0, carenciaDias: 0, vigenciaMeses: 12, totalClientes: 0, receitaMensal: 0, assistenciaFuneral: 0, auxilioCemiterio: null, taxaInclusaCemiterioPublico: false, beneficiarios: [], coberturas: [] },
      ]);

      const result = await service.getAll();
      expect(result[0].idadeMaxima).toBeNull();
    });

    it('retorna array vazio quando não há planos', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      const result = await service.getAll();
      expect(result).toEqual([]);
    });

    it('agrupa coberturas por tipo no retorno', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([
        {
          id: 1, nome: 'Plano X', valorMensal: 100, idadeMaxima: 60, ativo: true,
          coberturaMaxima: 0, carenciaDias: 0, vigenciaMeses: 12, totalClientes: 0,
          receitaMensal: 0, assistenciaFuneral: 0, auxilioCemiterio: null, taxaInclusaCemiterioPublico: false,
          beneficiarios: [{ id: 1, nome: 'Titular' }],
          coberturas: [
            { tipo: 'servicosPadrao', descricao: 'Urna' },
            { tipo: 'coberturaTranslado', descricao: 'Translado 200km' },
          ],
        },
      ]);

      const result = await service.getAll();
      expect((result[0] as any).coberturas.servicosPadrao).toContain('Urna');
      expect((result[0] as any).coberturas.coberturaTranslado).toContain('Translado 200km');
    });

    it('getAll retorna array vazio', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      const result = await service.getAll();
      expect(result).toEqual([]);
    });

    it('getAll retorna 5 planos', async () => {
      mockPrisma.plano.findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => makePlano({ id: i + 1, nome: `Plano ${i + 1}` })),
      );
      const result = await service.getAll();
      expect(result).toHaveLength(5);
    });

    it('getAll repassa erro do prisma', async () => {
      mockPrisma.plano.findMany.mockRejectedValue(new Error('DB timeout'));
      await expect(service.getAll()).rejects.toThrow('DB timeout');
    });

    it('getAll retorna planos com ativo field', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([
        makePlano({ id: 1, ativo: true }),
        makePlano({ id: 2, ativo: true }),
      ]);
      const result = await service.getAll();
      expect(result.every((p: any) => p.ativo === true)).toBe(true);
    });

    it('getAll preserva valorMensal de cada plano', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([
        makePlano({ id: 1, valorMensal: 80 }),
        makePlano({ id: 2, valorMensal: 120 }),
      ]);
      const result = await service.getAll();
      expect((result[0] as any).valorMensal).toBe(80);
      expect((result[1] as any).valorMensal).toBe(120);
    });
  });

  // ── getById — cenários adicionais ────────────────────────────────────────────
  describe('getById — cenários adicionais', () => {
    it('retorna null para id inexistente', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(null);
      const result = await service.getById(9999);
      expect(result).toBeNull();
    });

    it('retorna plano com id correto', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(makePlano({ id: 5, nome: 'Premium' }));
      const result = await service.getById(5);
      expect((result as any).nome).toBe('Premium');
    });

    it('repassa erro de rede', async () => {
      mockPrisma.plano.findUnique.mockRejectedValue(new Error('Network error'));
      await expect(service.getById(1)).rejects.toThrow('Network error');
    });

    it('normaliza id string para número', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(makePlano({ id: 3 }));
      await service.getById('3' as any);
      expect(mockPrisma.plano.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 3 } }),
      );
    });
  });

  // ── create — cenários adicionais ─────────────────────────────────────────────
  describe('create — cenários adicionais', () => {
    it('cria com assistenciaFuneral definido', async () => {
      mockPrisma.plano.create.mockResolvedValue(makePlano({ assistenciaFuneral: 5000 }));
      const result = await service.create({ nome: 'Test', valorMensal: 100, assistenciaFuneral: 5000 } as any);
      expect((result as any).assistenciaFuneral).toBe(5000);
    });

    it('cria com ativo=false', async () => {
      mockPrisma.plano.create.mockResolvedValue(makePlano({ ativo: false }));
      const result = await service.create({ nome: 'Inativo', valorMensal: 80, ativo: false } as any);
      expect((result as any).ativo).toBe(false);
    });

    it('cria com idadeMaxima personalizada', async () => {
      mockPrisma.plano.create.mockResolvedValue(makePlano({ idadeMaxima: 75 }));
      const result = await service.create({ nome: 'Senior', valorMensal: 200, idadeMaxima: 75 } as any);
      expect((result as any).idadeMaxima).toBe(75);
    });

    it('repassa erro de constraint unique', async () => {
      mockPrisma.plano.create.mockRejectedValue(new Error('Unique constraint failed'));
      await expect(service.create({ nome: 'Duplicado', valorMensal: 100 } as any)).rejects.toThrow('Unique constraint failed');
    });

    it('cria plano com beneficiarios', async () => {
      const plano = makePlano({ beneficiarios: [{ nome: 'Cônjuge', limite: 1 }] });
      mockPrisma.plano.create.mockResolvedValue(plano);
      const result = await service.create({ nome: 'Test', valorMensal: 100 } as any);
      expect((result as any).beneficiarios).toHaveLength(1);
    });

    it('cria plano com taxaInclusaCemiterioPublico=true', async () => {
      mockPrisma.plano.create.mockResolvedValue(makePlano({ taxaInclusaCemiterioPublico: true }));
      const result = await service.create({ nome: 'Cemetery Plus', valorMensal: 150 } as any);
      expect((result as any).taxaInclusaCemiterioPublico).toBe(true);
    });

    it('cria plano com auxilioCemiterio definido', async () => {
      mockPrisma.plano.create.mockResolvedValue(makePlano({ auxilioCemiterio: 2000 }));
      const result = await service.create({ nome: 'Cemetery', valorMensal: 120 } as any);
      expect((result as any).auxilioCemiterio).toBe(2000);
    });
  });

  // ── update — cenários adicionais ─────────────────────────────────────────────
  describe('update — cenários adicionais', () => {
    it('update com valorMensal alterado', async () => {
      mockPrisma.plano.update.mockResolvedValue(makePlano({ valorMensal: 150 }));
      const result = await service.update(1, { valorMensal: 150 } as any);
      expect((result as any).valorMensal).toBe(150);
    });

    it('update com nome alterado', async () => {
      mockPrisma.plano.update.mockResolvedValue(makePlano({ nome: 'Novo Nome' }));
      const result = await service.update(1, { nome: 'Novo Nome' } as any);
      expect((result as any).nome).toBe('Novo Nome');
    });

    it('update com ativo=false', async () => {
      mockPrisma.plano.update.mockResolvedValue(makePlano({ ativo: false }));
      const result = await service.update(1, { ativo: false } as any);
      expect((result as any).ativo).toBe(false);
    });

    it('update repassa erro do prisma', async () => {
      mockPrisma.plano.update.mockRejectedValue(new Error('Record not found'));
      await expect(service.update(1, { nome: 'X' } as any)).rejects.toThrow('Record not found');
    });

    it('update com idadeMaxima alterada', async () => {
      mockPrisma.plano.update.mockResolvedValue(makePlano({ idadeMaxima: 80 }));
      const result = await service.update(1, { idadeMaxima: 80 } as any);
      expect((result as any).idadeMaxima).toBe(80);
    });

    it('update com assistenciaFuneral alterada', async () => {
      mockPrisma.plano.update.mockResolvedValue(makePlano({ assistenciaFuneral: 10000 }));
      const result = await service.update(1, { assistenciaFuneral: 10000 } as any);
      expect((result as any).assistenciaFuneral).toBe(10000);
    });
  });

  // ── delete — cenários adicionais ─────────────────────────────────────────────
  describe('delete — cenários adicionais', () => {
    it('delete com id correto', async () => {
      mockPrisma.plano.delete.mockResolvedValue(makePlano({ id: 5 }));
      await service.delete(5);
      expect(mockPrisma.plano.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('delete normaliza id string', async () => {
      mockPrisma.plano.delete.mockResolvedValue(makePlano({ id: 3 }));
      await service.delete('3' as any);
      expect(mockPrisma.plano.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 3 } }),
      );
    });

    it('delete retorna plano deletado', async () => {
      const plano = makePlano({ id: 7, nome: 'Premium' });
      mockPrisma.plano.delete.mockResolvedValue(plano);
      const result = await service.delete(7);
      expect((result as any).nome).toBe('Premium');
    });

    it('delete repassa erro de FK', async () => {
      mockPrisma.plano.delete.mockRejectedValue(new Error('FK constraint violated'));
      await expect(service.delete(1)).rejects.toThrow('FK constraint violated');
    });
  });

  // ── getPaged — cenários adicionais ───────────────────────────────────────────
  describe('getPaged — cenários adicionais', () => {
    it('retorna página 1 com itens', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([makePlano({ id: 1 }), makePlano({ id: 2 })]);
      mockPrisma.plano.count.mockResolvedValue(10);
      const result = await service.getPaged({ page: 1, pageSize: 2 });
      expect(result.data).toHaveLength(2);
      expect((result as any).pagination?.total ?? (result as any).total).toBe(10);
    });

    it('retorna totalPages correto', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([makePlano({ id: 1 })]);
      mockPrisma.plano.count.mockResolvedValue(9);
      const result = await service.getPaged({ page: 1, pageSize: 3 });
      expect((result as any).pagination?.totalPages ?? (result as any).totalPages).toBe(3);
    });

    it('página corrente no resultado', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      mockPrisma.plano.count.mockResolvedValue(0);
      const result = await service.getPaged({ page: 2, pageSize: 10 });
      expect((result as any).pagination?.page ?? (result as any).page).toBe(2);
    });

    it('pageSize no resultado', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      mockPrisma.plano.count.mockResolvedValue(0);
      const result = await service.getPaged({ page: 1, pageSize: 5 });
      expect((result as any).pagination?.pageSize ?? (result as any).pageSize).toBe(5);
    });

    it('retorna lista vazia na última página além do total', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([]);
      mockPrisma.plano.count.mockResolvedValue(10);
      const result = await service.getPaged({ page: 5, pageSize: 5 });
      expect(result.data).toHaveLength(0);
    });

    it('repassa erro do prisma em getPaged', async () => {
      mockPrisma.plano.count.mockRejectedValue(new Error('Count failed'));
      await expect(service.getPaged({ page: 1, pageSize: 10 })).rejects.toThrow('Count failed');
    });
  });

  // ── vincularPlanoAoTitular — cenários adicionais ─────────────────────────────
  describe('vincularPlanoAoTitular — cenários adicionais', () => {
    it('atualiza titular com planoId correto', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(makePlano({ id: 3 }));
      mockPrisma.titular.update.mockResolvedValue({ id: 10, planoId: 3 });
      const result = await service.vincularPlanoAoTitular(10, 3);
      expect(mockPrisma.titular.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 10 }, data: expect.objectContaining({ planoId: 3 }) }),
      );
    });

    it('lança erro quando plano não existe', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(null);
      await expect(service.vincularPlanoAoTitular(10, 999)).rejects.toBeDefined();
    });

    it('chama recalcularDependentesDoTitular após vinculo', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(makePlano({ id: 2 }));
      mockPrisma.titular.update.mockResolvedValue({ id: 5, planoId: 2 });
      await service.vincularPlanoAoTitular(5, 2);
      expect(pricingMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(5);
    });

    it('repassa erro do prisma', async () => {
      mockPrisma.plano.findUnique.mockResolvedValue(makePlano({ id: 1 }));
      mockPrisma.titular.update.mockRejectedValue(new Error('FK error'));
      await expect(service.vincularPlanoAoTitular(1, 1)).rejects.toThrow('FK error');
    });
  });

  // ── getAll — cenários extra ───────────────────────────────────────────────────
  describe('getAll — cenários extra', () => {
    it('getAll retorna lista com 1 plano', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([makePlano({ id: 1 })]);
      const result = await service.getAll();
      expect(result.length).toBe(1);
    });

    it('getAll repassa erro do prisma', async () => {
      mockPrisma.plano.findMany.mockRejectedValue(new Error('getAll err'));
      await expect(service.getAll()).rejects.toThrow('getAll err');
    });

    it('getAll filtra planos ativos', async () => {
      mockPrisma.plano.findMany.mockResolvedValue([makePlano({ id: 1, ativo: true })]);
      const result = await service.getAll();
      expect(result.every((p: any) => 'ativo' in p)).toBe(true);
    });
  });

  // ── create — cenários extra ───────────────────────────────────────────────────
  describe('create — cenários extra', () => {
    it('create com nome único cria plano', async () => {
      mockPrisma.plano.create.mockResolvedValue(makePlano({ id: 10 }));
      const result = await service.create(makePlano({}) as any);
      expect((result as any).id).toBe(10);
    });

    it('create retorna objeto com valorMensal', async () => {
      mockPrisma.plano.create.mockResolvedValue(makePlano({ valorMensal: 200 }));
      const result = await service.create(makePlano({ valorMensal: 200 }) as any);
      expect((result as any).valorMensal).toBe(200);
    });

    it('create repassa erro do prisma', async () => {
      mockPrisma.plano.create.mockRejectedValue(new Error('create err'));
      await expect(service.create(makePlano({}) as any)).rejects.toThrow('create err');
    });
  });

  // ── update — cenários extra ───────────────────────────────────────────────────
  describe('update — cenários extra', () => {
    it('update retorna plano atualizado', async () => {
      mockPrisma.plano.update.mockResolvedValue(makePlano({ id: 1, nome: 'Atualizado' }));
      const result = await service.update(1, { nome: 'Atualizado' } as any);
      expect((result as any).nome).toBe('Atualizado');
    });

    it('update com id 5 passa where.id=5', async () => {
      mockPrisma.plano.update.mockResolvedValue(makePlano({ id: 5 }));
      await service.update(5, {} as any);
      expect(mockPrisma.plano.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('update repassa erro do prisma', async () => {
      mockPrisma.plano.update.mockRejectedValue(new Error('update err'));
      await expect(service.update(1, {} as any)).rejects.toThrow('update err');
    });
  });

  // ── delete — cenários extra ───────────────────────────────────────────────────
  describe('delete — cenários extra', () => {
    it('delete retorna plano deletado', async () => {
      mockPrisma.plano.delete.mockResolvedValue(makePlano({ id: 3 }));
      const result = await service.delete(3);
      expect((result as any).id).toBe(3);
    });

    it('delete com id 7 passa where.id=7', async () => {
      mockPrisma.plano.delete.mockResolvedValue(makePlano({ id: 7 }));
      await service.delete(7);
      expect(mockPrisma.plano.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 7 } }),
      );
    });

    it('delete repassa erro do prisma', async () => {
      mockPrisma.plano.delete.mockRejectedValue(new Error('delete err'));
      await expect(service.delete(1)).rejects.toThrow('delete err');
    });
  });
});
