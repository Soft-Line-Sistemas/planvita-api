const prismaMock = {
  beneficio: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: { validator: () => (v: unknown) => v },
}));

import { BeneficioService } from './beneficio.service';

describe('BeneficioService', () => {
  let service: BeneficioService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BeneficioService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new BeneficioService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new BeneficioService('')).toThrow('Tenant ID must be provided');
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new BeneficioService(undefined as any)).toThrow();
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista de benefícios', async () => {
      const lista = [{ id: 1, nome: 'Benefício A' }, { id: 2, nome: 'Benefício B' }];
      prismaMock.beneficio.findMany.mockResolvedValue(lista);
      const result = await service.getAll();
      expect(result).toEqual(lista);
      expect(prismaMock.beneficio.findMany).toHaveBeenCalled();
    });

    it('retorna lista vazia', async () => {
      prismaMock.beneficio.findMany.mockResolvedValue([]);
      expect(await service.getAll()).toEqual([]);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna benefício quando encontrado', async () => {
      const beneficio = { id: 1, nome: 'Benefício A' };
      prismaMock.beneficio.findUnique.mockResolvedValue(beneficio);
      const result = await service.getById(1);
      expect(prismaMock.beneficio.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(beneficio);
    });

    it('retorna null quando não encontrado', async () => {
      prismaMock.beneficio.findUnique.mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria benefício com os dados fornecidos', async () => {
      const data = { nome: 'Benefício Novo', descricao: 'Desc' } as any;
      const created = { id: 3, ...data };
      prismaMock.beneficio.create.mockResolvedValue(created);

      const result = await service.create(data);

      expect(prismaMock.beneficio.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(created);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza benefício pelo id', async () => {
      const updated = { id: 1, nome: 'Atualizado' };
      prismaMock.beneficio.update.mockResolvedValue(updated);

      const result = await service.update(1, { nome: 'Atualizado' } as any);

      expect(prismaMock.beneficio.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nome: 'Atualizado' },
      });
      expect(result).toEqual(updated);
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta benefício e retorna o registro', async () => {
      const deleted = { id: 1, nome: 'Benefício A' };
      prismaMock.beneficio.delete.mockResolvedValue(deleted);

      const result = await service.delete(1);

      expect(prismaMock.beneficio.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(deleted);
    });
  });
});
