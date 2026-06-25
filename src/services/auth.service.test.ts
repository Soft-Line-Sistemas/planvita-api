const prismaMock = {
  user: {
    findUnique: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mocked-token'),
}));

jest.mock('../config', () => ({
  __esModule: true,
  default: {
    jwt: { secret: 'test-secret', expiresIn: '1d' },
  },
}));

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';

const makeUser = (overrides = {}) => ({
  id: 1,
  nome: 'Admin Teste',
  email: 'admin@test.com',
  senhaHash: 'hashed-password',
  roles: [
    {
      role: {
        id: 10,
        name: 'admin',
        RolePermission: [
          { permission: { name: 'titular.view' } },
          { permission: { name: 'titular.create' } },
        ],
      },
    },
  ],
  ...overrides,
});

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new AuthService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new AuthService('')).toThrow('Tenant ID must be provided');
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new AuthService(undefined as any)).toThrow();
    });
  });

  // ── validateUser ────────────────────────────────────────────────────────
  describe('validateUser', () => {
    it('retorna payload com role e permissões quando credenciais válidas', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('admin@test.com', 'senha123');

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'admin@test.com' } }),
      );
      expect(bcrypt.compare).toHaveBeenCalledWith('senha123', 'hashed-password');
      expect(result).toEqual({
        id: 1,
        nome: 'Admin Teste',
        email: 'admin@test.com',
        role: { id: 10, name: 'admin' },
        permissions: ['titular.view', 'titular.create'],
        tenant: 'tenant-123',
      });
    });

    it('retorna null quando usuário não encontrado', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser('nao@existe.com', 'senha');

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('retorna null quando senha incorreta', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('admin@test.com', 'senha-errada');

      expect(result).toBeNull();
    });

    it('retorna role null e permissões vazias quando usuário sem roles', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ roles: [] }));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('admin@test.com', 'senha123');

      expect(result).not.toBeNull();
      expect(result!.role).toBeNull();
      expect(result!.permissions).toEqual([]);
    });

    it('retorna role null quando roles é undefined', async () => {
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ roles: undefined }));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('admin@test.com', 'senha123');

      expect(result!.role).toBeNull();
      expect(result!.permissions).toEqual([]);
    });
  });

  // ── generateToken ───────────────────────────────────────────────────────
  describe('generateToken', () => {
    it('gera token JWT com o payload do usuário', () => {
      const payload = {
        id: 1,
        nome: 'Admin',
        email: 'admin@test.com',
        role: { id: 10, name: 'admin' },
        permissions: ['titular.view'],
        tenant: 'tenant-123',
      };

      const token = service.generateToken(payload);

      expect(jwt.sign).toHaveBeenCalledWith(payload, 'test-secret', { expiresIn: '1d' });
      expect(token).toBe('mocked-token');
    });
  });
});
