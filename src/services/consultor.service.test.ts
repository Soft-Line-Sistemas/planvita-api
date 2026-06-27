const prismaMock = {
  consultor: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  comissao: {
    aggregate: jest.fn(),
    findMany: jest.fn(),
  },
};

const getPrismaForTenantMock = jest.fn();
const getConfiguredPublicTenantsMock = jest.fn();
const getTenantLabelMock = jest.fn();

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: (...args: unknown[]) => getPrismaForTenantMock(...args),
  Prisma: { validator: () => (v: unknown) => v },
}));

jest.mock('../utils/tenants', () => ({
  getConfiguredPublicTenants: () => getConfiguredPublicTenantsMock(),
  getTenantLabel: (...args: unknown[]) => getTenantLabelMock(...args),
}));

import { ConsultorService } from './consultor.service';

describe('ConsultorService', () => {
  let service: ConsultorService;

  beforeEach(() => {
    jest.clearAllMocks();
    getPrismaForTenantMock.mockReturnValue(prismaMock);
    getConfiguredPublicTenantsMock.mockReturnValue([]);
    getTenantLabelMock.mockImplementation((tenantId: string) => tenantId);
    service = new ConsultorService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new ConsultorService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new ConsultorService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista de consultores', async () => {
      const lista = [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Bruno' }];
      prismaMock.consultor.findMany.mockResolvedValue(lista);
      expect(await service.getAll()).toEqual(lista);
    });
  });

  // ── getPublicOptions ─────────────────────────────────────────────────────
  describe('getPublicOptions', () => {
    it('retorna apenas id e nome ordenados por nome', async () => {
      const options = [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Bruno' }];
      prismaMock.consultor.findMany.mockResolvedValue(options);

      const result = await service.getPublicOptions();

      expect(prismaMock.consultor.findMany).toHaveBeenCalledWith({
        select: { id: true, nome: true },
        orderBy: { nome: 'asc' },
      });
      expect(result).toEqual([
        {
          id: 1,
          nome: 'Ana (tenant-123)',
          nomeCompleto: 'Ana',
          tenantId: 'tenant-123',
          tenantLabel: 'tenant-123',
          selectionKey: 'tenant-123:1',
        },
        {
          id: 2,
          nome: 'Bruno (tenant-123)',
          nomeCompleto: 'Bruno',
          tenantId: 'tenant-123',
          tenantLabel: 'tenant-123',
          selectionKey: 'tenant-123:2',
        },
      ]);
    });
  });

  describe('getGlobalPublicOptions', () => {
    it('agrega consultores de tenants públicos, inclui selectionKey e ordena pelo nome formatado', async () => {
      const prismaTenantA = {
        consultor: {
          findMany: jest.fn().mockResolvedValue([
            { id: 2, nome: 'Bruno Silva' },
            { id: 1, nome: 'Ana Maria' },
          ]),
        },
      };
      const prismaTenantB = {
        consultor: {
          findMany: jest.fn().mockResolvedValue([{ id: 3, nome: 'Carlos Souza' }]),
        },
      };

      getConfiguredPublicTenantsMock.mockReturnValue(['tenant-b', 'tenant-a']);
      getTenantLabelMock.mockImplementation((tenantId: string) =>
        ({ 'tenant-a': 'Unidade A', 'tenant-b': 'Unidade B' })[tenantId] ?? tenantId,
      );
      getPrismaForTenantMock.mockImplementation((tenantId: string) => {
        if (tenantId === 'tenant-a') return prismaTenantA;
        if (tenantId === 'tenant-b') return prismaTenantB;
        return prismaMock;
      });

      const result = await ConsultorService.getGlobalPublicOptions();

      expect(prismaTenantA.consultor.findMany).toHaveBeenCalledWith({
        select: { id: true, nome: true },
        orderBy: { nome: 'asc' },
      });
      expect(prismaTenantB.consultor.findMany).toHaveBeenCalledWith({
        select: { id: true, nome: true },
        orderBy: { nome: 'asc' },
      });
      expect(result).toEqual([
        {
          id: 1,
          nome: 'Ana Maria (Unidade A)',
          nomeCompleto: 'Ana Maria',
          tenantId: 'tenant-a',
          tenantLabel: 'Unidade A',
          selectionKey: 'tenant-a:1',
        },
        {
          id: 2,
          nome: 'Bruno Silva (Unidade A)',
          nomeCompleto: 'Bruno Silva',
          tenantId: 'tenant-a',
          tenantLabel: 'Unidade A',
          selectionKey: 'tenant-a:2',
        },
        {
          id: 3,
          nome: 'Carlos Souza (Unidade B)',
          nomeCompleto: 'Carlos Souza',
          tenantId: 'tenant-b',
          tenantLabel: 'Unidade B',
          selectionKey: 'tenant-b:3',
        },
      ]);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna consultor quando encontrado', async () => {
      const consultor = { id: 1, nome: 'Ana' };
      prismaMock.consultor.findUnique.mockResolvedValue(consultor);
      expect(await service.getById(1)).toEqual(consultor);
    });

    it('retorna null quando não encontrado', async () => {
      prismaMock.consultor.findUnique.mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria consultor com os dados fornecidos', async () => {
      const data = { nome: 'Carlos', userId: 5 } as any;
      prismaMock.consultor.create.mockResolvedValue({ id: 3, ...data });

      const result = await service.create(data);
      expect(prismaMock.consultor.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(expect.objectContaining({ id: 3 }));
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza consultor pelo id', async () => {
      prismaMock.consultor.update.mockResolvedValue({ id: 1, nome: 'Atualizado' });
      const result = await service.update(1, { nome: 'Atualizado' } as any);
      expect(prismaMock.consultor.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { nome: 'Atualizado' } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta consultor pelo id', async () => {
      prismaMock.consultor.delete.mockResolvedValue({ id: 1, nome: 'Ana' });
      const result = await service.delete(1);
      expect(prismaMock.consultor.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── getResumoByUserId ────────────────────────────────────────────────────
  describe('getResumoByUserId', () => {
    it('retorna resumo com totais de comissão quando consultor encontrado', async () => {
      prismaMock.consultor.findUnique.mockResolvedValue({
        id: 1,
        nome: 'Ana',
        userId: 5,
        user: { id: 5, nome: 'Ana', email: 'ana@test.com' },
      });
      prismaMock.comissao.aggregate
        .mockResolvedValueOnce({ _sum: { valor: 300 } })
        .mockResolvedValueOnce({ _sum: { valor: 1200 } });

      const result = await service.getResumoByUserId(5);

      expect(result).toEqual(
        expect.objectContaining({
          id: 1,
          nome: 'Ana',
          comissaoPendente: 300,
          comissaoPaga: 1200,
        }),
      );
    });

    it('retorna null quando consultor não encontrado para o userId', async () => {
      prismaMock.consultor.findUnique.mockResolvedValue(null);
      const result = await service.getResumoByUserId(999);
      expect(result).toBeNull();
    });

    it('usa 0 quando _sum.valor é null', async () => {
      prismaMock.consultor.findUnique.mockResolvedValue({
        id: 1, nome: 'Ana', userId: 5, user: { id: 5, nome: 'Ana', email: 'ana@test.com' },
      });
      prismaMock.comissao.aggregate
        .mockResolvedValueOnce({ _sum: { valor: null } })
        .mockResolvedValueOnce({ _sum: { valor: null } });

      const result = await service.getResumoByUserId(5);
      expect(result!.comissaoPendente).toBe(0);
      expect(result!.comissaoPaga).toBe(0);
    });
  });

  // ── listarComissoesByUserId ──────────────────────────────────────────────
  describe('listarComissoesByUserId', () => {
    it('retorna consultor e lista de comissões com totais', async () => {
      prismaMock.consultor.findUnique.mockResolvedValue({ id: 1, nome: 'Ana' });
      prismaMock.comissao.findMany.mockResolvedValue([
        { id: 10, valor: 200, statusPagamento: 'PENDENTE', titular: {}, contaPagar: null },
        { id: 11, valor: 500, statusPagamento: 'PAGO', titular: {}, contaPagar: null },
      ]);

      const result = await service.listarComissoesByUserId(5);

      expect(result).toEqual(
        expect.objectContaining({
          consultor: { id: 1, nome: 'Ana' },
          totais: { pendente: 200, pago: 500 },
        }),
      );
      expect(result!.comissoes).toHaveLength(2);
    });

    it('retorna null quando consultor não existe para o userId', async () => {
      prismaMock.consultor.findUnique.mockResolvedValue(null);
      const result = await service.listarComissoesByUserId(999);
      expect(result).toBeNull();
    });
  });
});
