const txMock = {
  parceriaVantagem: { update: jest.fn(), create: jest.fn() },
  parceriaVantagemPlano: { deleteMany: jest.fn(), createMany: jest.fn() },
};

const prismaMock = {
  parceriaCategoria: { findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
  parceiro: { findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
  parceriaVantagem: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn() },
  parceriaVantagemPlano: { deleteMany: jest.fn(), createMany: jest.fn() },
  parceriaVantagemResgate: { create: jest.fn() },
  titular: { findUnique: jest.fn() },
  $transaction: jest.fn((cb: (tx: typeof txMock) => any) => cb(txMock)),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

import { ParceriasService } from './parcerias.service';

const makeVantagem = (overrides = {}) => ({
  id: 1,
  slug: 'oferta-x',
  titulo: 'Oferta X',
  descricaoCurta: 'Desc',
  descricaoCompleta: 'Completo',
  tipo: 'CONVENIO',
  valorDesconto: 10,
  validadeFim: null,
  destaque: false,
  status: 'PUBLICADO',
  publico: 'CLIENTES_ATIVOS',
  validadeInicio: null,
  regrasUso: null,
  instrucoesResgate: null,
  codigoCupom: null,
  linkResgate: null,
  categoria: { id: 1, nome: 'Cat', slug: 'cat', icone: null },
  parceiro: { id: 1, nome: 'Parceiro', slug: 'parceiro', logoUrl: null, cidade: 'SP', uf: 'SP', ativo: true, whatsapp: null },
  planos: [],
  ...overrides,
});

describe('ParceriasService', () => {
  let service: ParceriasService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ParceriasService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new ParceriasService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new ParceriasService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── listarCategorias ─────────────────────────────────────────────────────
  describe('listarCategorias', () => {
    it('retorna categorias ordenadas', async () => {
      prismaMock.parceriaCategoria.findMany.mockResolvedValue([{ id: 1, nome: 'Cat A' }]);
      const result = await service.listarCategorias();
      expect(result).toHaveLength(1);
    });
  });

  // ── salvarCategoria ──────────────────────────────────────────────────────
  describe('salvarCategoria', () => {
    it('cria nova categoria', async () => {
      prismaMock.parceriaCategoria.create.mockResolvedValue({ id: 2, nome: 'Nova Cat' });
      const result = await service.salvarCategoria({ nome: 'Nova Cat' });
      expect(prismaMock.parceriaCategoria.create).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 2 }));
    });

    it('atualiza categoria quando id fornecido', async () => {
      prismaMock.parceriaCategoria.update.mockResolvedValue({ id: 1, nome: 'Atualizada' });
      await service.salvarCategoria({ id: 1, nome: 'Atualizada' });
      expect(prismaMock.parceriaCategoria.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });

    it('lança erro quando nome vazio', async () => {
      await expect(service.salvarCategoria({ nome: '' })).rejects.toThrow('Nome da categoria é obrigatório');
    });

    it('gera slug a partir do nome quando slug não fornecido', async () => {
      prismaMock.parceriaCategoria.create.mockResolvedValue({ id: 3, nome: 'Saúde', slug: 'saude' });
      await service.salvarCategoria({ nome: 'Saúde' });
      expect(prismaMock.parceriaCategoria.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ slug: 'saude' }) }),
      );
    });
  });

  // ── listarParceiros ──────────────────────────────────────────────────────
  describe('listarParceiros', () => {
    it('lista parceiros sem filtro', async () => {
      prismaMock.parceiro.findMany.mockResolvedValue([{ id: 1, nome: 'Farmácia' }]);
      const result = await service.listarParceiros();
      expect(prismaMock.parceiro.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
      expect(result).toHaveLength(1);
    });

    it('lista parceiros com filtro de busca', async () => {
      prismaMock.parceiro.findMany.mockResolvedValue([]);
      await service.listarParceiros('farm');
      expect(prismaMock.parceiro.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }),
      );
    });
  });

  // ── salvarParceiro ───────────────────────────────────────────────────────
  describe('salvarParceiro', () => {
    it('cria parceiro', async () => {
      prismaMock.parceiro.create.mockResolvedValue({ id: 5, nome: 'Novo Parceiro' });
      const result = await service.salvarParceiro({ nome: 'Novo Parceiro' });
      expect(prismaMock.parceiro.create).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 5 }));
    });

    it('atualiza parceiro quando id fornecido', async () => {
      prismaMock.parceiro.update.mockResolvedValue({ id: 2, nome: 'Atualizado' });
      await service.salvarParceiro({ id: 2, nome: 'Atualizado' });
      expect(prismaMock.parceiro.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 } }));
    });

    it('lança erro quando nome vazio', async () => {
      await expect(service.salvarParceiro({ nome: '' })).rejects.toThrow('Nome do parceiro é obrigatório');
    });
  });

  // ── listarVantagensAdmin ─────────────────────────────────────────────────
  describe('listarVantagensAdmin', () => {
    it('lista vantagens sem filtros', async () => {
      prismaMock.parceriaVantagem.findMany.mockResolvedValue([makeVantagem()]);
      const result = await service.listarVantagensAdmin({});
      expect(result).toHaveLength(1);
    });

    it('filtra por status, categoriaId, parceiroId e q', async () => {
      prismaMock.parceriaVantagem.findMany.mockResolvedValue([]);
      await service.listarVantagensAdmin({ status: 'PUBLICADO', categoriaId: 1, parceiroId: 2, q: 'abc' });
      expect(prismaMock.parceriaVantagem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PUBLICADO', categoriaId: 1, parceiroId: 2 }),
        }),
      );
    });
  });

  // ── salvarVantagem ───────────────────────────────────────────────────────
  describe('salvarVantagem', () => {
    it('cria vantagem', async () => {
      txMock.parceriaVantagem.create.mockResolvedValue({ id: 10, titulo: 'Oferta' });
      txMock.parceriaVantagemPlano.createMany.mockResolvedValue({ count: 0 });
      const result = await service.salvarVantagem({ parceiroId: 1, titulo: 'Oferta' });
      expect(txMock.parceriaVantagem.create).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 10 }));
    });

    it('atualiza vantagem quando id fornecido', async () => {
      txMock.parceriaVantagem.update.mockResolvedValue({ id: 5, titulo: 'Atualizado' });
      txMock.parceriaVantagemPlano.deleteMany.mockResolvedValue({ count: 0 });
      txMock.parceriaVantagemPlano.createMany.mockResolvedValue({ count: 0 });
      await service.salvarVantagem({ id: 5, parceiroId: 1, titulo: 'Atualizado' });
      expect(txMock.parceriaVantagem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 } }));
    });

    it('associa planos quando planoIds fornecido', async () => {
      txMock.parceriaVantagem.create.mockResolvedValue({ id: 11 });
      txMock.parceriaVantagemPlano.createMany.mockResolvedValue({ count: 2 });
      await service.salvarVantagem({ parceiroId: 1, titulo: 'X', planoIds: [3, 4] });
      expect(txMock.parceriaVantagemPlano.createMany).toHaveBeenCalledWith({
        data: [{ vantagemId: 11, planoId: 3 }, { vantagemId: 11, planoId: 4 }],
      });
    });

    it('lança erro quando campos obrigatórios ausentes', async () => {
      await expect(service.salvarVantagem({ titulo: 'X' })).rejects.toThrow('Parceiro, título e slug são obrigatórios');
    });
  });

  // ── excluirVantagem ──────────────────────────────────────────────────────
  describe('excluirVantagem', () => {
    it('exclui vantagem pelo id', async () => {
      prismaMock.parceriaVantagem.delete.mockResolvedValue({ id: 1 });
      const result = await service.excluirVantagem(1);
      expect(prismaMock.parceriaVantagem.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual({ id: 1 });
    });
  });

  // ── listarCategoriasCliente ──────────────────────────────────────────────
  describe('listarCategoriasCliente', () => {
    it('lista apenas categorias ativas', async () => {
      prismaMock.parceriaCategoria.findMany.mockResolvedValue([{ id: 1, nome: 'Cat', ativo: true }]);
      const result = await service.listarCategoriasCliente();
      expect(prismaMock.parceriaCategoria.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ativo: true } }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ── listarVantagensCliente ───────────────────────────────────────────────
  describe('listarVantagensCliente', () => {
    beforeEach(() => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 1, planoId: 1, statusPlano: 'ATIVO' });
    });

    it('retorna vantagens com elegivel=true para titular ativo e vantagem CLIENTES_ATIVOS', async () => {
      prismaMock.parceriaVantagem.findMany.mockResolvedValue([makeVantagem()]);
      const result = await service.listarVantagensCliente(1, {});
      expect(result[0].elegivel).toBe(true);
    });

    it('retorna elegivel=false quando titular está inativo', async () => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 1, planoId: 1, statusPlano: 'SUSPENSO' });
      prismaMock.parceriaVantagem.findMany.mockResolvedValue([makeVantagem()]);
      const result = await service.listarVantagensCliente(1, {});
      expect(result[0].elegivel).toBe(false);
    });

    it('retorna elegivel=true para vantagem PUBLICO independente do status do titular', async () => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 1, planoId: 1, statusPlano: 'SUSPENSO' });
      prismaMock.parceriaVantagem.findMany.mockResolvedValue([makeVantagem({ publico: 'PUBLICO' })]);
      const result = await service.listarVantagensCliente(1, {});
      expect(result[0].elegivel).toBe(true);
    });

    it('retorna elegivel=false para PLANOS_ESPECIFICOS quando plano não confere', async () => {
      prismaMock.parceriaVantagem.findMany.mockResolvedValue([
        makeVantagem({ publico: 'PLANOS_ESPECIFICOS', planos: [{ planoId: 99 }] }),
      ]);
      const result = await service.listarVantagensCliente(1, {});
      expect(result[0].elegivel).toBe(false);
    });

    it('lança erro quando titular não encontrado', async () => {
      prismaMock.titular.findUnique.mockResolvedValue(null);
      await expect(service.listarVantagensCliente(999, {})).rejects.toThrow('Titular não encontrado');
    });
  });

  // ── obterVantagemCliente ─────────────────────────────────────────────────
  describe('obterVantagemCliente', () => {
    it('retorna null quando vantagem não encontrada', async () => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 1, planoId: 1, statusPlano: 'ATIVO' });
      prismaMock.parceriaVantagem.findFirst.mockResolvedValue(null);
      const result = await service.obterVantagemCliente(1, 'slug-inexistente');
      expect(result).toBeNull();
    });

    it('lança erro quando titular não encontrado', async () => {
      prismaMock.titular.findUnique.mockResolvedValue(null);
      await expect(service.obterVantagemCliente(999, 'qualquer')).rejects.toThrow('Titular não encontrado');
    });
  });

  // ── registrarResgate ─────────────────────────────────────────────────────
  describe('registrarResgate', () => {
    it('cria registro de resgate', async () => {
      prismaMock.parceriaVantagemResgate.create.mockResolvedValue({ id: 1, titularId: 1, vantagemId: 5 });
      const result = await service.registrarResgate(1, 5, 'app');
      expect(prismaMock.parceriaVantagemResgate.create).toHaveBeenCalledWith({
        data: { titularId: 1, vantagemId: 5, canal: 'app' },
      });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });

    it('cria resgate sem canal', async () => {
      prismaMock.parceriaVantagemResgate.create.mockResolvedValue({ id: 2, canal: null });
      await service.registrarResgate(1, 5);
      expect(prismaMock.parceriaVantagemResgate.create).toHaveBeenCalledWith({
        data: { titularId: 1, vantagemId: 5, canal: null },
      });
    });
  });

  // ── listarVantagensPublicas ──────────────────────────────────────────────
  describe('listarVantagensPublicas', () => {
    it('retorna vantagens públicas com elegivel baseado no publico', async () => {
      prismaMock.parceriaVantagem.findMany.mockResolvedValue([
        makeVantagem({ publico: 'PUBLICO' }),
        makeVantagem({ id: 2, publico: 'CLIENTES_ATIVOS' }),
      ]);
      const result = await service.listarVantagensPublicas({});
      expect(result[0].elegivel).toBe(true);
      expect(result[1].elegivel).toBe(false);
    });

    it('respeita limit com máximo de 6', async () => {
      prismaMock.parceriaVantagem.findMany.mockResolvedValue([]);
      await service.listarVantagensPublicas({ limit: 100 });
      expect(prismaMock.parceriaVantagem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 6 }),
      );
    });
  });
});
