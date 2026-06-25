const txMock = {
  consultor: { findUnique: jest.fn() },
  titular: { findUnique: jest.fn() },
  comissao: { findFirst: jest.fn(), create: jest.fn() },
  contaPagar: { create: jest.fn() },
};

const prismaMock = {
  comissao: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn((cb: (tx: typeof txMock) => any) => cb(txMock)),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: { validator: () => (v: unknown) => v },
}));

import { ComissaoService } from './comissao.service';

describe('ComissaoService', () => {
  let service: ComissaoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ComissaoService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new ComissaoService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new ComissaoService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── getAll ──────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('retorna lista de comissões', async () => {
      const lista = [{ id: 1, valor: 100 }];
      prismaMock.comissao.findMany.mockResolvedValue(lista);
      expect(await service.getAll()).toEqual(lista);
    });
  });

  // ── getById ─────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('retorna comissão quando encontrada', async () => {
      const com = { id: 1, valor: 100 };
      prismaMock.comissao.findUnique.mockResolvedValue(com);
      expect(await service.getById(1)).toEqual(com);
    });

    it('retorna null quando não encontrada', async () => {
      prismaMock.comissao.findUnique.mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });
  });

  // ── createManual ────────────────────────────────────────────────────────
  describe('createManual', () => {
    const validInput = { vendedorId: 1, titularId: 2, valor: 500 };

    beforeEach(() => {
      txMock.consultor.findUnique.mockResolvedValue({ id: 1, nome: 'Vendedor' });
      txMock.titular.findUnique.mockResolvedValue({ id: 2, nome: 'Cliente' });
      txMock.comissao.findFirst.mockResolvedValue(null);
      txMock.contaPagar.create.mockResolvedValue({ id: 10 });
      txMock.comissao.create.mockResolvedValue({ id: 99, vendedorId: 1, titularId: 2, valor: 500 });
    });

    it('cria comissão manual com conta a pagar', async () => {
      const result = await service.createManual(validInput);
      expect(txMock.contaPagar.create).toHaveBeenCalled();
      expect(txMock.comissao.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ vendedorId: 1, titularId: 2, valor: 500 }) }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 99 }));
    });

    it('cria comissão sem conta a pagar quando criarContaPagar=false', async () => {
      await service.createManual({ ...validInput, criarContaPagar: false });
      expect(txMock.contaPagar.create).not.toHaveBeenCalled();
    });

    it('usa statusPagamento PAGO quando informado', async () => {
      await service.createManual({ ...validInput, statusPagamento: 'PAGO' });
      expect(txMock.contaPagar.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PAGO' }) }),
      );
    });

    it('lança erro quando vendedorId inválido', async () => {
      await expect(service.createManual({ ...validInput, vendedorId: -1 })).rejects.toThrow('vendedorId inválido');
    });

    it('lança erro quando titularId inválido', async () => {
      await expect(service.createManual({ ...validInput, titularId: 0 })).rejects.toThrow('titularId inválido');
    });

    it('lança erro quando valor inválido', async () => {
      await expect(service.createManual({ ...validInput, valor: -100 })).rejects.toThrow('valor inválido');
    });

    it('lança erro quando consultor não encontrado', async () => {
      txMock.consultor.findUnique.mockResolvedValue(null);
      await expect(service.createManual(validInput)).rejects.toThrow('Consultor não encontrado');
    });

    it('lança erro quando titular não encontrado', async () => {
      txMock.titular.findUnique.mockResolvedValue(null);
      await expect(service.createManual(validInput)).rejects.toThrow('Titular não encontrado');
    });

    it('lança erro quando titular já possui comissão', async () => {
      txMock.comissao.findFirst.mockResolvedValue({ id: 5 });
      await expect(service.createManual(validInput)).rejects.toThrow('Titular já possui comissão cadastrada');
    });

    it('aceita dataGeracao como string ISO', async () => {
      await service.createManual({ ...validInput, dataGeracao: '2026-01-15' });
      expect(txMock.comissao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dataGeracao: new Date('2026-01-15') }),
        }),
      );
    });
  });

  // ── create ──────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria comissão quando titular não tem comissão existente', async () => {
      prismaMock.comissao.findFirst.mockResolvedValue(null);
      prismaMock.comissao.create.mockResolvedValue({ id: 1, titularId: 5, valor: 200 });

      const result = await service.create({ titularId: 5, valor: 200 } as any);

      expect(prismaMock.comissao.create).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('lança erro quando titular já possui comissão', async () => {
      prismaMock.comissao.findFirst.mockResolvedValue({ id: 3 });
      await expect(service.create({ titularId: 5 } as any)).rejects.toThrow('Titular já possui comissão cadastrada');
    });

    it('pula verificação quando titularId não está presente', async () => {
      prismaMock.comissao.create.mockResolvedValue({ id: 1 });
      await service.create({ valor: 100 } as any);
      expect(prismaMock.comissao.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    beforeEach(() => {
      prismaMock.comissao.findUniqueOrThrow.mockResolvedValue({ id: 1 });
      prismaMock.comissao.findFirst.mockResolvedValue(null);
      prismaMock.comissao.update.mockResolvedValue({ id: 1, statusPagamento: 'PAGO' });
    });

    it('atualiza comissão com statusPagamento', async () => {
      const result = await service.update(1, { statusPagamento: 'PAGO' } as any);
      expect(prismaMock.comissao.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('converte campo "status" para statusPagamento', async () => {
      await service.update(1, { status: 'PAGO' } as any);
      expect(prismaMock.comissao.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ statusPagamento: 'PAGO' }),
        }),
      );
    });

    it('lança erro quando titular id já tem outra comissão', async () => {
      prismaMock.comissao.findFirst.mockResolvedValue({ id: 99 });
      await expect(service.update(1, { titularId: 5 } as any)).rejects.toThrow('Titular já possui comissão cadastrada');
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta comissão pelo id', async () => {
      prismaMock.comissao.delete.mockResolvedValue({ id: 1, valor: 100 });
      const result = await service.delete(1);
      expect(prismaMock.comissao.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({ id: 1, valor: 100 });
    });
  });
});
