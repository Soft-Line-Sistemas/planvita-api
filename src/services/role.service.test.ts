const prismaMock = {
  role: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  rolePermission: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: { validator: () => (v: unknown) => v },
}));

import { RoleService } from './role.service';

describe('RoleService', () => {
  let service: RoleService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RoleService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new RoleService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new RoleService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista de roles com permissões', async () => {
      const roles = [{ id: 1, name: 'admin', RolePermission: [{ permissionId: 10 }] }];
      prismaMock.role.findMany.mockResolvedValue(roles);
      const result = await service.getAll();
      expect(prismaMock.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: { RolePermission: { select: { permissionId: true } } } }),
      );
      expect(result).toEqual(roles);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna role com permissões quando encontrada', async () => {
      const role = { id: 1, name: 'admin', RolePermission: [] };
      prismaMock.role.findUnique.mockResolvedValue(role);
      const result = await service.getById(1);
      expect(prismaMock.role.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(result).toEqual(role);
    });

    it('retorna null quando não encontrada', async () => {
      prismaMock.role.findUnique.mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria role com os dados fornecidos', async () => {
      const data = { name: 'consultor', description: 'Consultor' } as any;
      prismaMock.role.create.mockResolvedValue({ id: 5, ...data });
      const result = await service.create(data);
      expect(prismaMock.role.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(expect.objectContaining({ id: 5 }));
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza role pelo id', async () => {
      prismaMock.role.update.mockResolvedValue({ id: 1, name: 'superadmin' });
      const result = await service.update(1, { name: 'superadmin' } as any);
      expect(prismaMock.role.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { name: 'superadmin' } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta role pelo id', async () => {
      prismaMock.role.delete.mockResolvedValue({ id: 1, name: 'admin' });
      const result = await service.delete(1);
      expect(prismaMock.role.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── updatePermissions ────────────────────────────────────────────────────
  describe('updatePermissions', () => {
    it('atualiza permissões de uma role existente', async () => {
      prismaMock.role.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.rolePermission.deleteMany.mockResolvedValue({ count: 2 });
      prismaMock.rolePermission.createMany.mockResolvedValue({ count: 3 });

      const result = await service.updatePermissions(1, [10, 11, 12]);

      expect(prismaMock.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 1 } });
      expect(prismaMock.rolePermission.createMany).toHaveBeenCalledWith({
        data: [
          { roleId: 1, permissionId: 10 },
          { roleId: 1, permissionId: 11 },
          { roleId: 1, permissionId: 12 },
        ],
      });
      expect(result).toEqual({ roleId: 1, updatedPermissions: [10, 11, 12] });
    });

    it('atualiza para nenhuma permissão (lista vazia)', async () => {
      prismaMock.role.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.rolePermission.deleteMany.mockResolvedValue({ count: 3 });
      prismaMock.rolePermission.createMany.mockResolvedValue({ count: 0 });

      const result = await service.updatePermissions(1, []);

      expect(prismaMock.rolePermission.createMany).toHaveBeenCalledWith({ data: [] });
      expect(result).toEqual({ roleId: 1, updatedPermissions: [] });
    });

    it('lança erro quando role não existe', async () => {
      prismaMock.role.findUnique.mockResolvedValue(null);
      await expect(service.updatePermissions(999, [1])).rejects.toThrow('Role not found');
    });
  });
});
