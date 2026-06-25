const prismaMock = {
  notificationTemplate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: { validator: () => (v: unknown) => v },
}));

const mockLoggerInstance = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockLoggerInstance),
}));

import { NotificacaoTemplateService } from './notificacao-template.service';

const makeTemplate = (overrides = {}) => ({
  id: 1,
  tenantId: 'tenant-123',
  nome: 'Template Teste',
  canal: 'email',
  flow: null,
  assunto: 'Assunto',
  htmlBody: '<p>Corpo</p>',
  textBody: 'Corpo',
  anexos: null,
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('NotificacaoTemplateService', () => {
  let service: NotificacaoTemplateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificacaoTemplateService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new NotificacaoTemplateService('abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new NotificacaoTemplateService('')).toThrow('Tenant ID must be provided');
    });
  });

  // ── listar ──────────────────────────────────────────────────────────────
  describe('listar', () => {
    it('lista todos os templates sem filtro de flow', async () => {
      prismaMock.notificationTemplate.findMany.mockResolvedValue([makeTemplate()]);
      const result = await service.listar();
      expect(prismaMock.notificationTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-123' }) }),
      );
      expect(result).toHaveLength(1);
    });

    it('filtra por flow quando fornecido', async () => {
      prismaMock.notificationTemplate.findMany.mockResolvedValue([]);
      await service.listar('cadastro');
      expect(prismaMock.notificationTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ OR: expect.any(Array) }),
        }),
      );
    });
  });

  // ── criar ───────────────────────────────────────────────────────────────
  describe('criar', () => {
    it('cria template com dados válidos', async () => {
      prismaMock.notificationTemplate.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.notificationTemplate.create.mockResolvedValue(makeTemplate({ nome: 'Novo' }));

      const result = await service.criar({ nome: 'Novo', canal: 'email' });

      expect(prismaMock.notificationTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ nome: 'Novo', canal: 'email', tenantId: 'tenant-123' }),
        }),
      );
      expect(result.nome).toBe('Novo');
    });

    it('desmarca defaults quando isDefault=true', async () => {
      prismaMock.notificationTemplate.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.notificationTemplate.create.mockResolvedValue(makeTemplate({ isDefault: true }));

      await service.criar({ nome: 'Default', canal: 'email', isDefault: true });

      expect(prismaMock.notificationTemplate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isDefault: false } }),
      );
    });

    it('lança erro quando payload vazio', async () => {
      await expect(service.criar({})).rejects.toThrow('Payload inválido');
    });

    it('lança erro quando nome está vazio', async () => {
      await expect(service.criar({ nome: '  ', canal: 'email' })).rejects.toThrow('Nome é obrigatório');
    });

    it('normaliza canal para lowercase', async () => {
      prismaMock.notificationTemplate.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.notificationTemplate.create.mockResolvedValue(makeTemplate({ canal: 'whatsapp' }));

      await service.criar({ nome: 'T', canal: 'WHATSAPP' });

      expect(prismaMock.notificationTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ canal: 'whatsapp' }) }),
      );
    });
  });

  // ── atualizar ────────────────────────────────────────────────────────────
  describe('atualizar', () => {
    it('atualiza template pelo id', async () => {
      prismaMock.notificationTemplate.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.notificationTemplate.update.mockResolvedValue(makeTemplate({ nome: 'Atualizado' }));

      const result = await service.atualizar(1, { nome: 'Atualizado' });

      expect(prismaMock.notificationTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
      expect(result.nome).toBe('Atualizado');
    });

    it('lança erro quando nome atualizado está vazio', async () => {
      await expect(service.atualizar(1, { nome: '' })).rejects.toThrow('Nome é obrigatório');
    });

    it('desmarca defaults quando atualiza para isDefault=true', async () => {
      prismaMock.notificationTemplate.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.notificationTemplate.update.mockResolvedValue(makeTemplate({ isDefault: true }));

      await service.atualizar(1, { isDefault: true, canal: 'email' });

      expect(prismaMock.notificationTemplate.updateMany).toHaveBeenCalled();
    });
  });

  // ── remover ──────────────────────────────────────────────────────────────
  describe('remover', () => {
    it('remove template pelo id', async () => {
      prismaMock.notificationTemplate.delete.mockResolvedValue(makeTemplate());
      const result = await service.remover(1);
      expect(prismaMock.notificationTemplate.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── obterDefault ─────────────────────────────────────────────────────────
  describe('obterDefault', () => {
    it('retorna template default por canal', async () => {
      const tmpl = makeTemplate({ isDefault: true });
      prismaMock.notificationTemplate.findFirst.mockResolvedValue(tmpl);

      const result = await service.obterDefault('email');

      expect(prismaMock.notificationTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ canal: 'email', isDefault: true, flow: null }),
        }),
      );
      expect(result).toEqual(tmpl);
    });

    it('busca primeiro por flow específico, depois por flow null', async () => {
      const tmplFlow = makeTemplate({ flow: 'cadastro', isDefault: true });
      prismaMock.notificationTemplate.findFirst
        .mockResolvedValueOnce(tmplFlow)
        .mockResolvedValueOnce(null);

      const result = await service.obterDefault('email', 'cadastro');
      expect(result).toEqual(tmplFlow);
    });

    it('retorna default sem flow quando flow específico não existe', async () => {
      const tmplSemFlow = makeTemplate({ isDefault: true });
      // First call (with specific flow) returns null; second call (flow: null) returns the template
      prismaMock.notificationTemplate.findFirst.mockReset();
      prismaMock.notificationTemplate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(tmplSemFlow);

      const result = await service.obterDefault('email', 'cadastro');
      expect(result).toEqual(tmplSemFlow);
    });

    it('retorna null quando não há template default', async () => {
      prismaMock.notificationTemplate.findFirst.mockReset();
      prismaMock.notificationTemplate.findFirst.mockResolvedValue(null);
      const result = await service.obterDefault('email');
      expect(result).toBeNull();
    });
  });
});
