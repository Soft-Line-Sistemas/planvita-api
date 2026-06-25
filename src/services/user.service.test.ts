const prismaMock = {
  user: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  userRole: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  role: {
    findUnique: jest.fn(),
  },
  consultor: {
    upsert: jest.fn(),
  },
  comissao: {
    groupBy: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: { validator: () => (v: unknown) => v },
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn(),
}));

import bcrypt from 'bcryptjs';
import { UserService } from './user.service';

const makeUserFull = (overrides = {}) => ({
  id: 1,
  nome: 'Admin',
  email: 'admin@test.com',
  senhaHash: 'hashed',
  roles: [{ role: { id: 10, name: 'admin' } }],
  consultor: null,
  ...overrides,
});

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.comissao.groupBy.mockResolvedValue([]);
    service = new UserService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new UserService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new UserService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna usuários com comissão pendente incluída', async () => {
      const usuarios = [
        makeUserFull({ consultor: { id: 5, valorComissaoIndicacao: 0, percentualComissaoIndicacao: 0 } }),
      ];
      prismaMock.user.findMany.mockResolvedValue(usuarios);
      prismaMock.comissao.groupBy.mockResolvedValue([{ vendedorId: 5, _sum: { valor: 300 } }]);

      const result = await service.getAll();
      expect(result[0].consultor).toEqual(expect.objectContaining({ comissaoPendente: 300 }));
    });

    it('usa 0 para comissão pendente quando não há comissão', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        makeUserFull({ consultor: { id: 5, valorComissaoIndicacao: 0, percentualComissaoIndicacao: 0 } }),
      ]);
      prismaMock.comissao.groupBy.mockResolvedValue([]);
      const result = await service.getAll();
      expect(result[0].consultor).toEqual(expect.objectContaining({ comissaoPendente: 0 }));
    });

    it('não quebra quando não há consultores', async () => {
      prismaMock.user.findMany.mockResolvedValue([makeUserFull()]);
      const result = await service.getAll();
      expect(result[0].consultor).toBeNull();
      expect(prismaMock.comissao.groupBy).not.toHaveBeenCalled();
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna usuário com roles e consultor', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUserFull());
      const result = await service.getById(1);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria usuário sem role', async () => {
      prismaMock.user.create.mockResolvedValue({ id: 2, nome: 'Novo', email: 'novo@test.com', senhaHash: 'h' });
      const result = await service.create({ nome: 'Novo', email: 'novo@test.com' });
      expect(prismaMock.user.create).toHaveBeenCalled();
      expect(prismaMock.userRole.create).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 2, email: 'novo@test.com' }));
    });

    it('cria usuário com role não-consultor', async () => {
      prismaMock.user.create.mockResolvedValue({ id: 3, nome: 'User', email: 'u@test.com', senhaHash: 'h' });
      prismaMock.userRole.create.mockResolvedValue({ role: { name: 'admin' } });

      const result = await service.create({ nome: 'User', email: 'u@test.com', roleId: 10 });

      expect(prismaMock.userRole.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userId: 3, roleId: 10 } }),
      );
      expect(prismaMock.consultor.upsert).not.toHaveBeenCalled();
      expect(result.roleId).toBe(10);
    });

    it('cria consultor automaticamente quando role é consultor', async () => {
      prismaMock.user.create.mockResolvedValue({ id: 4, nome: 'Vend', email: 'v@test.com', senhaHash: 'h' });
      prismaMock.userRole.create.mockResolvedValue({ role: { name: 'consultor' } });
      prismaMock.consultor.upsert.mockResolvedValue({ id: 7, valorComissaoIndicacao: 50, percentualComissaoIndicacao: 10 });

      const result = await service.create({ nome: 'Vend', email: 'v@test.com', roleId: 5, valorComissaoIndicacao: 50, percentualComissaoIndicacao: 10 });

      expect(prismaMock.consultor.upsert).toHaveBeenCalled();
      expect(result.consultorId).toBe(7);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza usuário pelo id', async () => {
      prismaMock.user.update.mockResolvedValue({ id: 1, nome: 'Atualizado' });
      const result = await service.update(1, { nome: 'Atualizado' } as any);
      expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { nome: 'Atualizado' } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta usuário pelo id', async () => {
      prismaMock.user.delete.mockResolvedValue({ id: 1 });
      const result = await service.delete(1);
      expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({ id: 1 });
    });
  });

  // ── updateEmail ──────────────────────────────────────────────────────────
  describe('updateEmail', () => {
    it('atualiza email quando usuário existe', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.user.update.mockResolvedValue({ id: 1, email: 'novo@email.com' });

      const result = await service.updateEmail(1, 'novo@email.com');
      expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { email: 'novo@email.com' } });
      expect(result).toEqual(expect.objectContaining({ email: 'novo@email.com' }));
    });

    it('lança erro quando usuário não encontrado', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(service.updateEmail(999, 'x@x.com')).rejects.toThrow('Usuário não encontrado');
    });
  });

  // ── updatePassword ───────────────────────────────────────────────────────
  describe('updatePassword', () => {
    it('atualiza senha fazendo hash', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 1 });
      prismaMock.user.update.mockResolvedValue({ id: 1 });

      await service.updatePassword(1, 'nova-senha');

      expect(bcrypt.hash).toHaveBeenCalledWith('nova-senha', 10);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { senhaHash: 'hashed-password' },
      });
    });

    it('lança erro quando usuário não encontrado', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(service.updatePassword(999, 'senha')).rejects.toThrow('Usuário não encontrado');
    });
  });

  // ── verifyPassword ───────────────────────────────────────────────────────
  describe('verifyPassword', () => {
    it('retorna true quando senha confere', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ senhaHash: 'hashed' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const result = await service.verifyPassword(1, 'senha123');
      expect(result).toBe(true);
    });

    it('retorna false quando senha incorreta', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ senhaHash: 'hashed' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const result = await service.verifyPassword(1, 'errada');
      expect(result).toBe(false);
    });

    it('retorna null quando usuário não encontrado', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      const result = await service.verifyPassword(999, 'senha');
      expect(result).toBeNull();
    });
  });

  // ── updateUserRole ───────────────────────────────────────────────────────
  describe('updateUserRole', () => {
    it('atualiza role do usuário', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 1, nome: 'Admin' });
      prismaMock.role.findUnique.mockResolvedValue({ id: 10 });
      prismaMock.userRole.deleteMany.mockResolvedValue({ count: 1 });
      prismaMock.userRole.create.mockResolvedValue({ userId: 1, roleId: 10, role: { name: 'admin' } });

      const result = await service.updateUserRole(1, 10);

      expect(prismaMock.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } });
      expect(prismaMock.userRole.create).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ userId: 1, roleId: 10 }));
    });

    it('cria consultor quando nova role é consultor', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 1, nome: 'Vend' });
      prismaMock.role.findUnique.mockResolvedValue({ id: 5 });
      prismaMock.userRole.deleteMany.mockResolvedValue({ count: 1 });
      prismaMock.userRole.create.mockResolvedValue({ userId: 1, roleId: 5, role: { name: 'consultor' } });
      prismaMock.consultor.upsert.mockResolvedValue({ id: 9 });

      await service.updateUserRole(1, 5, 100, 5);

      expect(prismaMock.consultor.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          create: expect.objectContaining({ nome: 'Vend', valorComissaoIndicacao: 100 }),
        }),
      );
    });

    it('lança erro quando usuário não encontrado', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.role.findUnique.mockResolvedValue({ id: 10 });
      await expect(service.updateUserRole(999, 10)).rejects.toThrow('Usuário não encontrado');
    });

    it('lança erro quando role não encontrada', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 1, nome: 'X' });
      prismaMock.role.findUnique.mockResolvedValue(null);
      await expect(service.updateUserRole(1, 999)).rejects.toThrow('Role não encontrada');
    });
  });
});
