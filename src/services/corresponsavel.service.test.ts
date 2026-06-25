const prismaMock = {
  corresponsavel: {
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

import { CorresponsavelService } from './corresponsavel.service';

describe('CorresponsavelService', () => {
  let service: CorresponsavelService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CorresponsavelService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new CorresponsavelService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new CorresponsavelService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista de corresponsáveis', async () => {
      const lista = [{ id: 1, nome: 'João' }];
      prismaMock.corresponsavel.findMany.mockResolvedValue(lista);
      expect(await service.getAll()).toEqual(lista);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna corresponsável quando encontrado', async () => {
      prismaMock.corresponsavel.findUnique.mockResolvedValue({ id: 1, nome: 'João' });
      expect(await service.getById(1)).toEqual({ id: 1, nome: 'João' });
    });

    it('retorna null quando não encontrado', async () => {
      prismaMock.corresponsavel.findUnique.mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria corresponsável', async () => {
      const data = { nome: 'Maria', titularId: 10 } as any;
      prismaMock.corresponsavel.create.mockResolvedValue({ id: 2, ...data });
      const result = await service.create(data);
      expect(prismaMock.corresponsavel.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(expect.objectContaining({ id: 2 }));
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza corresponsável com id válido', async () => {
      prismaMock.corresponsavel.update.mockResolvedValue({ id: 1, nome: 'Atualizado' });
      const result = await service.update(1, { nome: 'Atualizado' } as any);
      expect(prismaMock.corresponsavel.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { nome: 'Atualizado' } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('lança erro com id inválido (zero)', async () => {
      await expect(service.update(0, {})).rejects.toThrow('ID inválido');
    });

    it('lança erro com id inválido (negativo)', async () => {
      await expect(service.update(-1, {})).rejects.toThrow('ID inválido');
    });

    it('lança erro com id inválido (decimal)', async () => {
      await expect(service.update(1.5, {})).rejects.toThrow('ID inválido');
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta corresponsável com id válido', async () => {
      prismaMock.corresponsavel.delete.mockResolvedValue({ id: 1, nome: 'João' });
      const result = await service.delete(1);
      expect(prismaMock.corresponsavel.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('lança erro com id inválido (zero)', async () => {
      await expect(service.delete(0)).rejects.toThrow('ID inválido');
    });

    it('lança erro com id inválido (negativo)', async () => {
      await expect(service.delete(-5)).rejects.toThrow('ID inválido');
    });
  });
});
