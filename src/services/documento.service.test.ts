const prismaMock = {
  documento: {
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

import { DocumentoService } from './documento.service';

describe('DocumentoService', () => {
  let service: DocumentoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DocumentoService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new DocumentoService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new DocumentoService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista de documentos', async () => {
      const lista = [{ id: 1, tipo: 'RG' }];
      prismaMock.documento.findMany.mockResolvedValue(lista);
      expect(await service.getAll()).toEqual(lista);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna documento quando encontrado', async () => {
      prismaMock.documento.findUnique.mockResolvedValue({ id: 1, tipo: 'CPF' });
      const result = await service.getById(1);
      expect(prismaMock.documento.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({ id: 1, tipo: 'CPF' });
    });

    it('retorna null quando não encontrado', async () => {
      prismaMock.documento.findUnique.mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria documento com os dados fornecidos', async () => {
      const data = { tipo: 'CNH', numero: '12345' } as any;
      prismaMock.documento.create.mockResolvedValue({ id: 5, ...data });
      const result = await service.create(data);
      expect(prismaMock.documento.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(expect.objectContaining({ id: 5 }));
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza documento pelo id', async () => {
      prismaMock.documento.update.mockResolvedValue({ id: 1, tipo: 'CNH' });
      const result = await service.update(1, { tipo: 'CNH' } as any);
      expect(prismaMock.documento.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { tipo: 'CNH' } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta documento pelo id', async () => {
      prismaMock.documento.delete.mockResolvedValue({ id: 1 });
      const result = await service.delete(1);
      expect(prismaMock.documento.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({ id: 1 });
    });
  });
});
