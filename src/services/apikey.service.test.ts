const prismaMock = {
  apiKey: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $executeRawUnsafe: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: { validator: () => (v: unknown) => v },
}));

jest.mock('../utils/helpers', () => ({
  generateApiKey: jest.fn().mockReturnValue('plain-key-abc'),
  hashApiKey: jest.fn().mockResolvedValue('hashed-key-abc'),
}));

import { ApiKeyService } from './apikey.service';

const makeKey = (overrides = {}) => ({
  id: 'key-1',
  tenantId: 'tenant-123',
  name: 'My Key',
  keyHash: 'hashed',
  isActive: true,
  permissions: '{}',
  rateLimit: 100,
  windowMs: 900000,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastUsedAt: null,
  ...overrides,
});

describe('ApiKeyService', () => {
  let service: ApiKeyService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$executeRawUnsafe.mockResolvedValue(undefined);
    service = new ApiKeyService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new ApiKeyService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new ApiKeyService('')).toThrow('Tenant ID must be provided');
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new ApiKeyService(undefined as any)).toThrow();
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista sem o campo keyHash', async () => {
      const raw = [makeKey(), makeKey({ id: 'key-2', name: 'Key 2' })];
      prismaMock.apiKey.findMany.mockResolvedValue(raw);

      const result = await service.getAll();

      expect(prismaMock.apiKey.findMany).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      result.forEach((k: any) => expect(k).not.toHaveProperty('keyHash'));
    });

    it('retorna lista vazia quando não há chaves', async () => {
      prismaMock.apiKey.findMany.mockResolvedValue([]);
      const result = await service.getAll();
      expect(result).toEqual([]);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna chave sem keyHash quando encontrada', async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue(makeKey());
      const result = await service.getById('key-1');
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('keyHash');
    });

    it('retorna null quando não encontrada', async () => {
      prismaMock.apiKey.findUnique.mockResolvedValue(null);
      const result = await service.getById('nao-existe');
      expect(result).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria chave com valores padrão e retorna a plainKey', async () => {
      const created = makeKey({ name: 'API Key' });
      prismaMock.apiKey.create.mockResolvedValue(created);

      const result = await service.create({});

      expect(prismaMock.$executeRawUnsafe).toHaveBeenCalled();
      expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'API Key',
            isActive: true,
            rateLimit: 100,
            windowMs: 900000,
          }),
        }),
      );
      expect((result as any).apiKey).toBe('plain-key-abc');
      expect(result).not.toHaveProperty('keyHash');
    });

    it('cria chave com dados customizados', async () => {
      const created = makeKey({ name: 'Custom', rateLimit: 50, windowMs: 60000 });
      prismaMock.apiKey.create.mockResolvedValue(created);

      await service.create({ name: '  Custom  ', rateLimit: 50, windowMs: 60000, isActive: false, permissions: '{"read":true}' });

      expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Custom',
            rateLimit: 50,
            windowMs: 60000,
            isActive: false,
            permissions: '{"read":true}',
          }),
        }),
      );
    });

    it('usa defaults para rateLimit/windowMs inválidos', async () => {
      prismaMock.apiKey.create.mockResolvedValue(makeKey());

      await service.create({ rateLimit: NaN, windowMs: undefined });

      expect(prismaMock.apiKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rateLimit: 100, windowMs: 900000 }),
        }),
      );
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza todos os campos fornecidos', async () => {
      const updated = makeKey({ name: 'Updated', isActive: false });
      prismaMock.apiKey.update.mockResolvedValue(updated);

      const result = await service.update('key-1', { name: 'Updated', isActive: false, rateLimit: 200, windowMs: 1800000, permissions: '{"x":1}' });

      expect(prismaMock.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: expect.objectContaining({ name: 'Updated', isActive: false, rateLimit: 200, windowMs: 1800000 }),
      });
      expect(result).not.toHaveProperty('keyHash');
    });

    it('ignora campos undefined', async () => {
      prismaMock.apiKey.update.mockResolvedValue(makeKey());
      await service.update('key-1', {});
      expect(prismaMock.apiKey.update).toHaveBeenCalledWith({ where: { id: 'key-1' }, data: {} });
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta a chave e retorna sem keyHash', async () => {
      prismaMock.apiKey.delete.mockResolvedValue(makeKey());

      const result = await service.delete('key-1');

      expect(prismaMock.apiKey.delete).toHaveBeenCalledWith({ where: { id: 'key-1' } });
      expect(result).not.toHaveProperty('keyHash');
    });
  });
});
