const prismaMock = {
  beneficiarioTipo: {
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

import { BeneficiarioTipoService } from './beneficiariotipo.service';

describe('BeneficiarioTipoService', () => {
  let service: BeneficiarioTipoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BeneficiarioTipoService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new BeneficiarioTipoService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new BeneficiarioTipoService('')).toThrow('Tenant ID must be provided');
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new BeneficiarioTipoService(undefined as any)).toThrow();
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista de tipos', async () => {
      const tipos = [{ id: 1, nome: 'Titular', idadeMax: null }];
      prismaMock.beneficiarioTipo.findMany.mockResolvedValue(tipos);
      const result = await service.getAll();
      expect(result).toEqual(tipos);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna tipo quando encontrado', async () => {
      const tipo = { id: 1, nome: 'Filho', idadeMax: 21 };
      prismaMock.beneficiarioTipo.findUnique.mockResolvedValue(tipo);
      const result = await service.getById(1);
      expect(prismaMock.beneficiarioTipo.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(tipo);
    });

    it('retorna null quando não encontrado', async () => {
      prismaMock.beneficiarioTipo.findUnique.mockResolvedValue(null);
      const result = await service.getById(999);
      expect(result).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria tipo com nome e idadeMax válidos', async () => {
      const created = { id: 2, nome: 'Cônjuge', idadeMax: null };
      prismaMock.beneficiarioTipo.create.mockResolvedValue(created);

      const result = await service.create({ nome: '  Cônjuge  ', idadeMax: null } as any);

      expect(prismaMock.beneficiarioTipo.create).toHaveBeenCalledWith({
        data: { nome: 'Cônjuge', idadeMax: null },
      });
      expect(result).toEqual(created);
    });

    it('cria tipo com idadeMax numérico', async () => {
      prismaMock.beneficiarioTipo.create.mockResolvedValue({ id: 3, nome: 'Filho', idadeMax: 21 });
      await service.create({ nome: 'Filho', idadeMax: 21 } as any);
      expect(prismaMock.beneficiarioTipo.create).toHaveBeenCalledWith({
        data: { nome: 'Filho', idadeMax: 21 },
      });
    });

    it('lança erro quando nome está vazio', async () => {
      await expect(service.create({ nome: '   ' } as any)).rejects.toThrow('Nome é obrigatório');
    });

    it('lança erro quando idadeMax é negativo', async () => {
      await expect(service.create({ nome: 'Filho', idadeMax: -1 } as any)).rejects.toThrow('idadeMax inválido');
    });

    it('lança erro quando idadeMax não é número', async () => {
      await expect(service.create({ nome: 'Filho', idadeMax: 'abc' } as any)).rejects.toThrow('idadeMax inválido');
    });

    it('converte idadeMax string vazia para null', async () => {
      prismaMock.beneficiarioTipo.create.mockResolvedValue({ id: 4, nome: 'Pai', idadeMax: null });
      await service.create({ nome: 'Pai', idadeMax: '' } as any);
      expect(prismaMock.beneficiarioTipo.create).toHaveBeenCalledWith({
        data: { nome: 'Pai', idadeMax: null },
      });
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza nome', async () => {
      prismaMock.beneficiarioTipo.update.mockResolvedValue({ id: 1, nome: 'Novo', idadeMax: null });
      await service.update(1, { nome: 'Novo' });
      expect(prismaMock.beneficiarioTipo.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nome: 'Novo' },
      });
    });

    it('lança erro ao atualizar com nome vazio', async () => {
      await expect(service.update(1, { nome: '' })).rejects.toThrow('Nome é obrigatório');
    });

    it('atualiza idadeMax para null quando string vazia', async () => {
      prismaMock.beneficiarioTipo.update.mockResolvedValue({ id: 1, nome: 'X', idadeMax: null });
      await service.update(1, { idadeMax: '' } as any);
      expect(prismaMock.beneficiarioTipo.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { idadeMax: null },
      });
    });

    it('lança erro ao atualizar com idadeMax inválido', async () => {
      await expect(service.update(1, { idadeMax: -5 } as any)).rejects.toThrow('idadeMax inválido');
    });

    it('ignora campos não fornecidos', async () => {
      prismaMock.beneficiarioTipo.update.mockResolvedValue({ id: 1 });
      await service.update(1, {});
      expect(prismaMock.beneficiarioTipo.update).toHaveBeenCalledWith({ where: { id: 1 }, data: {} });
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta tipo pelo id', async () => {
      const deleted = { id: 1, nome: 'Titular', idadeMax: null };
      prismaMock.beneficiarioTipo.delete.mockResolvedValue(deleted);
      const result = await service.delete(1);
      expect(prismaMock.beneficiarioTipo.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(deleted);
    });
  });
});
