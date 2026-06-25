const prismaMock = {
  permission: {
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

import { PermissionService } from './permission.service';

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PermissionService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new PermissionService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new PermissionService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista de permissões', async () => {
      const lista = [{ id: 1, name: 'titular.view' }];
      prismaMock.permission.findMany.mockResolvedValue(lista);
      expect(await service.getAll()).toEqual(lista);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna permissão quando encontrada', async () => {
      prismaMock.permission.findUnique.mockResolvedValue({ id: 1, name: 'titular.view' });
      expect(await service.getById(1)).toEqual({ id: 1, name: 'titular.view' });
    });

    it('retorna null quando não encontrada', async () => {
      prismaMock.permission.findUnique.mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria permissão com nome válido', async () => {
      prismaMock.permission.create.mockResolvedValue({ id: 2, name: 'titular.delete' });
      const result = await service.create({ name: '  titular.delete  ' });
      expect(prismaMock.permission.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'titular.delete' }) }),
      );
      expect(result).toEqual({ id: 2, name: 'titular.delete' });
    });

    it('inclui description quando fornecido', async () => {
      prismaMock.permission.create.mockResolvedValue({ id: 3, name: 'x', description: 'Desc' });
      await service.create({ name: 'x', description: 'Desc' });
      expect(prismaMock.permission.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ description: 'Desc' }) }),
      );
    });

    it('lança erro quando nome está vazio', async () => {
      await expect(service.create({ name: '   ' })).rejects.toThrow('Nome é obrigatório');
    });

    it('lança erro quando nome não é string', async () => {
      await expect(service.create({ name: undefined })).rejects.toThrow('Nome é obrigatório');
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza nome e description', async () => {
      prismaMock.permission.update.mockResolvedValue({ id: 1, name: 'novo.nome', description: 'Nova desc' });
      const result = await service.update(1, { name: 'novo.nome', description: 'Nova desc' });
      expect(prismaMock.permission.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { name: 'novo.nome', description: 'Nova desc' },
      });
      expect(result.name).toBe('novo.nome');
    });

    it('lança erro quando nome atualizado está vazio', async () => {
      await expect(service.update(1, { name: '  ' })).rejects.toThrow('Nome é obrigatório');
    });

    it('lança erro quando nenhum campo válido é fornecido', async () => {
      await expect(service.update(1, {})).rejects.toThrow('Nenhum campo válido para atualizar');
    });

    it('atualiza apenas description', async () => {
      prismaMock.permission.update.mockResolvedValue({ id: 1, name: 'x', description: 'Atualizado' });
      await service.update(1, { description: 'Atualizado' });
      expect(prismaMock.permission.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { description: 'Atualizado' },
      });
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta permissão pelo id', async () => {
      prismaMock.permission.delete.mockResolvedValue({ id: 1, name: 'titular.view' });
      const result = await service.delete(1);
      expect(prismaMock.permission.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({ id: 1, name: 'titular.view' });
    });
  });
});
