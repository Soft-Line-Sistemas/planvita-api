const prismaMock = {
  layoutConfig: {
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

import { LayoutConfigService } from './layoutconfig.service';

describe('LayoutConfigService', () => {
  let service: LayoutConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LayoutConfigService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new LayoutConfigService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new LayoutConfigService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista de configurações', async () => {
      const lista = [{ id: 1, tenantId: 'tenant-123' }];
      prismaMock.layoutConfig.findMany.mockResolvedValue(lista);
      expect(await service.getAll()).toEqual(lista);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna configuração quando encontrada', async () => {
      const cfg = { id: 1, primaryColor: '#000' };
      prismaMock.layoutConfig.findUnique.mockResolvedValue(cfg);
      const result = await service.getById(1);
      expect(prismaMock.layoutConfig.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(cfg);
    });

    it('retorna null quando não encontrada', async () => {
      prismaMock.layoutConfig.findUnique.mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria configuração com os dados fornecidos', async () => {
      const data = { primaryColor: '#FF0000', tenantId: 'tenant-123' } as any;
      prismaMock.layoutConfig.create.mockResolvedValue({ id: 2, ...data });
      const result = await service.create(data);
      expect(prismaMock.layoutConfig.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(expect.objectContaining({ id: 2 }));
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza configuração pelo id', async () => {
      prismaMock.layoutConfig.update.mockResolvedValue({ id: 1, primaryColor: '#00FF00' });
      const result = await service.update(1, { primaryColor: '#00FF00' } as any);
      expect(prismaMock.layoutConfig.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { primaryColor: '#00FF00' } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta configuração pelo id', async () => {
      prismaMock.layoutConfig.delete.mockResolvedValue({ id: 1 });
      const result = await service.delete(1);
      expect(prismaMock.layoutConfig.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({ id: 1 });
    });
  });
});
