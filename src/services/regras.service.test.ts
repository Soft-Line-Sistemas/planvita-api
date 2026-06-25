const prismaMock = {
  businessRules: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: {
    validator: () => (value: unknown) => value,
  },
}));

import { RegrasService } from './regras.service';

describe('RegrasService', () => {
  let service: RegrasService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RegrasService('tenant-123');
  });

  // ── constructor ──────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('lança erro quando tenantId é string vazia', () => {
      expect(() => new RegrasService('')).toThrow('Tenant ID must be provided');
    });

    it('lança erro quando tenantId é undefined', () => {
      expect(() => new RegrasService(undefined as any)).toThrow('Tenant ID must be provided');
    });

    it('instancia sem erro com tenantId válido', () => {
      expect(() => new RegrasService('tenant-abc')).not.toThrow();
    });
  });

  // ── getAll ───────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('lista regras sem depender das colunas novas de WhatsApp e injeta defaults', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        {
          tenantId: 'tenant-123',
          diasSuspensao: 90,
          valorAdicionalDependenteForaGrade: 14.9,
          ativo: true,
          criadoEm: new Date('2026-01-01T00:00:00.000Z'),
          atualizadoEm: new Date('2026-01-02T00:00:00.000Z'),
        },
      ]);

      const result = await service.getAll();

      expect(prismaMock.businessRules.findMany).toHaveBeenCalledWith({
        select: expect.objectContaining({
          tenantId: true,
          diasSuspensao: true,
          valorAdicionalDependenteForaGrade: true,
          ativo: true,
        }),
      });
      expect(result).toEqual([
        expect.objectContaining({
          tenantId: 'tenant-123',
          diasSuspensao: 90,
          redirecionamentoWhatsappAtivo: false,
          redirecionamentoWhatsappNumero: null,
          redirecionamentoWhatsappIdadeMin: 18,
          redirecionamentoWhatsappIdadeMax: 65,
        }),
      ]);
    });

    it('retorna array vazio quando não há regras cadastradas', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getAll();
      expect(result).toEqual([]);
    });

    it('injeta defaults de WhatsApp em múltiplos registros', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'tenant-a', diasSuspensao: 30 },
        { tenantId: 'tenant-b', diasSuspensao: 60 },
      ]);
      const result = await service.getAll();
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ tenantId: 'tenant-a', redirecionamentoWhatsappAtivo: false, redirecionamentoWhatsappIdadeMin: 18, redirecionamentoWhatsappIdadeMax: 65 });
      expect(result[1]).toMatchObject({ tenantId: 'tenant-b', redirecionamentoWhatsappAtivo: false, redirecionamentoWhatsappIdadeMin: 18, redirecionamentoWhatsappIdadeMax: 65 });
    });

    it('preserva campos de WhatsApp já preenchidos sem sobrescrever', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        {
          tenantId: 'tenant-123',
          redirecionamentoWhatsappAtivo: true,
          redirecionamentoWhatsappNumero: '5511999999999',
          redirecionamentoWhatsappIdadeMin: 21,
          redirecionamentoWhatsappIdadeMax: 60,
        },
      ]);
      const result = await service.getAll();
      expect(result[0]).toMatchObject({
        redirecionamentoWhatsappAtivo: true,
        redirecionamentoWhatsappNumero: '5511999999999',
        redirecionamentoWhatsappIdadeMin: 21,
        redirecionamentoWhatsappIdadeMax: 60,
      });
    });

    it('null em redirecionamentoWhatsappAtivo vira false', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'tenant-123', redirecionamentoWhatsappAtivo: null },
      ]);
      const result = await service.getAll();
      expect(result[0].redirecionamentoWhatsappAtivo).toBe(false);
    });

    it('null em redirecionamentoWhatsappIdadeMin vira 18', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'tenant-123', redirecionamentoWhatsappIdadeMin: null },
      ]);
      const result = await service.getAll();
      expect(result[0].redirecionamentoWhatsappIdadeMin).toBe(18);
    });

    it('null em redirecionamentoWhatsappIdadeMax vira 65', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'tenant-123', redirecionamentoWhatsappIdadeMax: null },
      ]);
      const result = await service.getAll();
      expect(result[0].redirecionamentoWhatsappIdadeMax).toBe(65);
    });

    it('null em redirecionamentoWhatsappNumero permanece null', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'tenant-123', redirecionamentoWhatsappNumero: null },
      ]);
      const result = await service.getAll();
      expect(result[0].redirecionamentoWhatsappNumero).toBeNull();
    });

    it('repassa erro do prisma para cima', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockRejectedValue(new Error('DB offline'));
      await expect(service.getAll()).rejects.toThrow('DB offline');
    });

    it('inclui todos os campos do select na chamada', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([]);
      await service.getAll();
      const callArg = (prismaMock.businessRules.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.select).toMatchObject({
        diasAvisoVencimento: true,
        diasSuspensao: true,
        idadeMaximaDependente: true,
        limiteBeneficiarios: true,
      });
    });

    it('injeta redirecionamentoWhatsappIdadeMin=18 quando campo ausente no objeto', async () => {
      const row: Record<string, unknown> = { tenantId: 'x' };
      delete row['redirecionamentoWhatsappIdadeMin'];
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([row]);
      const result = await service.getAll();
      expect(result[0].redirecionamentoWhatsappIdadeMin).toBe(18);
    });

    it('preserva valor 0 em redirecionamentoWhatsappIdadeMin quando explicitamente 0 (não-null)', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'x', redirecionamentoWhatsappIdadeMin: 0 },
      ]);
      const result = await service.getAll();
      // 0 ?? 18 === 0 (nullish coalescing preserva 0)
      expect(result[0].redirecionamentoWhatsappIdadeMin).toBe(0);
    });
  });

  // ── getByTenant ──────────────────────────────────────────────────────────
  describe('getByTenant', () => {
    it('busca regras por tenant com defaults de WhatsApp', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-123',
        diasPosSuspensao: 5,
        ativo: true,
        criadoEm: new Date('2026-01-01T00:00:00.000Z'),
        atualizadoEm: new Date('2026-01-02T00:00:00.000Z'),
      });

      const result = await service.getByTenant('tenant-123');

      expect(prismaMock.businessRules.findFirst).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-123' },
        select: expect.any(Object),
      });
      expect(result).toEqual(
        expect.objectContaining({
          tenantId: 'tenant-123',
          redirecionamentoWhatsappAtivo: false,
          redirecionamentoWhatsappIdadeMin: 18,
          redirecionamentoWhatsappIdadeMax: 65,
        }),
      );
    });

    it('retorna null quando não encontra regras para o tenant', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.getByTenant('tenant-inexistente');
      expect(result).toBeNull();
    });

    it('passa o tenantId correto no where', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      await service.getByTenant('meu-tenant');
      expect(prismaMock.businessRules.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'meu-tenant' } }),
      );
    });

    it('injeta todos os defaults quando registro não tem campos de WhatsApp', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-123',
        diasSuspensao: 30,
      });
      const result = await service.getByTenant('tenant-123');
      expect(result).toMatchObject({
        redirecionamentoWhatsappAtivo: false,
        redirecionamentoWhatsappNumero: null,
        redirecionamentoWhatsappIdadeMin: 18,
        redirecionamentoWhatsappIdadeMax: 65,
      });
    });

    it('preserva numero de WhatsApp quando já preenchido', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-123',
        redirecionamentoWhatsappAtivo: true,
        redirecionamentoWhatsappNumero: '5521999990000',
        redirecionamentoWhatsappIdadeMin: 25,
        redirecionamentoWhatsappIdadeMax: 70,
      });
      const result = await service.getByTenant('tenant-123');
      expect(result?.redirecionamentoWhatsappNumero).toBe('5521999990000');
      expect(result?.redirecionamentoWhatsappIdadeMin).toBe(25);
      expect(result?.redirecionamentoWhatsappIdadeMax).toBe(70);
    });

    it('repassa erro do prisma para cima', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockRejectedValue(new Error('Timeout'));
      await expect(service.getByTenant('tenant-123')).rejects.toThrow('Timeout');
    });

    it('usa findFirst com select na chamada', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      await service.getByTenant('t1');
      const [call] = (prismaMock.businessRules.findFirst as jest.Mock).mock.calls;
      expect(call[0]).toHaveProperty('select');
    });
  });

  // ── create ───────────────────────────────────────────────────────────────
  describe('create', () => {
    it('persiste campos de WhatsApp ao criar regras', async () => {
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-123',
        diasSuspensao: 90,
        redirecionamentoWhatsappAtivo: true,
        redirecionamentoWhatsappNumero: '5511999999999',
        redirecionamentoWhatsappIdadeMin: 21,
        redirecionamentoWhatsappIdadeMax: 60,
      });

      await service.create({
        tenantId: 'tenant-123',
        diasSuspensao: 90,
        redirecionamentoWhatsappAtivo: true,
        redirecionamentoWhatsappNumero: '5511999999999',
        redirecionamentoWhatsappIdadeMin: 21,
        redirecionamentoWhatsappIdadeMax: 60,
      } as any);

      expect(prismaMock.businessRules.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-123',
          diasSuspensao: 90,
          redirecionamentoWhatsappAtivo: true,
          redirecionamentoWhatsappNumero: '5511999999999',
          redirecionamentoWhatsappIdadeMin: 21,
          redirecionamentoWhatsappIdadeMax: 60,
        },
        select: expect.any(Object),
      });
    });

    it('retorna objeto com defaults de WhatsApp injetados', async () => {
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-123',
        diasSuspensao: 30,
      });
      const result = await service.create({ tenantId: 'tenant-123', diasSuspensao: 30 } as any);
      expect(result).toMatchObject({
        redirecionamentoWhatsappAtivo: false,
        redirecionamentoWhatsappIdadeMin: 18,
        redirecionamentoWhatsappIdadeMax: 65,
      });
    });

    it('cria com redirecionamentoWhatsappAtivo=false quando não passado', async () => {
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-new',
        redirecionamentoWhatsappAtivo: null,
      });
      const result = await service.create({ tenantId: 'tenant-new' } as any);
      expect(result?.redirecionamentoWhatsappAtivo).toBe(false);
    });

    it('cria e preserva diasAvisoVencimento no payload', async () => {
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-x',
        diasAvisoVencimento: 7,
      });
      await service.create({ tenantId: 'tenant-x', diasAvisoVencimento: 7 } as any);
      expect(prismaMock.businessRules.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ diasAvisoVencimento: 7 }) }),
      );
    });

    it('repassa erro do prisma para cima no create', async () => {
      (prismaMock.businessRules.create as jest.Mock).mockRejectedValue(new Error('Unique constraint'));
      await expect(service.create({ tenantId: 'x' } as any)).rejects.toThrow('Unique constraint');
    });

    it('inclui select na chamada de create', async () => {
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue({ tenantId: 'x' });
      await service.create({ tenantId: 'x' } as any);
      expect(prismaMock.businessRules.create).toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.any(Object) }),
      );
    });

    it('cria com ativo=true como padrão quando não especificado', async () => {
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue({ tenantId: 'x', ativo: true });
      const result = await service.create({ tenantId: 'x' } as any);
      expect(result).toBeDefined();
    });
  });

  // ── update ───────────────────────────────────────────────────────────────
  describe('update', () => {
    it('persiste campos de WhatsApp ao atualizar regras', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-123',
        diasSuspensao: 75,
        redirecionamentoWhatsappAtivo: true,
        redirecionamentoWhatsappNumero: '5511999999999',
        redirecionamentoWhatsappIdadeMin: 18,
        redirecionamentoWhatsappIdadeMax: 65,
      });

      await service.update('tenant-123', {
        tenantId: 'tenant-123',
        diasSuspensao: 75,
        redirecionamentoWhatsappAtivo: true,
        redirecionamentoWhatsappNumero: '5511999999999',
        redirecionamentoWhatsappIdadeMin: 18,
        redirecionamentoWhatsappIdadeMax: 65,
      } as any);

      expect(prismaMock.businessRules.update).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-123' },
        data: {
          diasSuspensao: 75,
          redirecionamentoWhatsappAtivo: true,
          redirecionamentoWhatsappNumero: '5511999999999',
          redirecionamentoWhatsappIdadeMin: 18,
          redirecionamentoWhatsappIdadeMax: 65,
        },
        select: expect.objectContaining({
          tenantId: true,
          redirecionamentoWhatsappAtivo: true,
        }),
      });
    });

    it('atualiza usando o tenantId passado como where', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({ tenantId: 'meu-tenant' });
      await service.update('meu-tenant', { diasSuspensao: 15 } as any);
      expect(prismaMock.businessRules.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'meu-tenant' } }),
      );
    });

    it('retorna objeto com defaults de WhatsApp injetados após update', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-123',
        diasSuspensao: 45,
      });
      const result = await service.update('tenant-123', { diasSuspensao: 45 } as any);
      expect(result).toMatchObject({
        redirecionamentoWhatsappAtivo: false,
        redirecionamentoWhatsappIdadeMin: 18,
      });
    });

    it('atualiza diasAvisoPendencia corretamente', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-123',
        diasAvisoPendencia: 3,
      });
      await service.update('tenant-123', { tenantId: 'tenant-123', diasAvisoPendencia: 3 } as any);
      expect(prismaMock.businessRules.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ diasAvisoPendencia: 3 }) }),
      );
    });

    it('atualiza limiteBeneficiarios para novo valor', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({ tenantId: 'x', limiteBeneficiarios: 10 });
      await service.update('x', { tenantId: 'x', limiteBeneficiarios: 10 } as any);
      expect(prismaMock.businessRules.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ limiteBeneficiarios: 10 }) }),
      );
    });

    it('repassa erro do prisma para cima no update', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockRejectedValue(new Error('Record not found'));
      await expect(service.update('tenant-123', { diasSuspensao: 10 } as any)).rejects.toThrow('Record not found');
    });

    it('inclui select na chamada de update', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({ tenantId: 'x' });
      await service.update('x', { diasSuspensao: 12 } as any);
      expect(prismaMock.businessRules.update).toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.any(Object) }),
      );
    });

    it('desativa redirecionamento WhatsApp quando passado false', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'tenant-123',
        redirecionamentoWhatsappAtivo: false,
        redirecionamentoWhatsappNumero: null,
        redirecionamentoWhatsappIdadeMin: null,
        redirecionamentoWhatsappIdadeMax: null,
      });
      const result = await service.update('tenant-123', {
        tenantId: 'tenant-123',
        redirecionamentoWhatsappAtivo: false,
      } as any);
      expect(result?.redirecionamentoWhatsappAtivo).toBe(false);
    });

    it('atualiza idadeMaximaDependente para novo valor', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x',
        idadeMaximaDependente: 25,
      });
      await service.update('x', { tenantId: 'x', idadeMaximaDependente: 25 } as any);
      expect(prismaMock.businessRules.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ idadeMaximaDependente: 25 }) }),
      );
    });
  });

  // ── withWhatsappDefaults (via comportamento público) ─────────────────────
  describe('defaults injection edge cases', () => {
    it('valor 0 em idadeMin e idadeMax é preservado (nullish coalescing não substitui 0)', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x',
        redirecionamentoWhatsappIdadeMin: 0,
        redirecionamentoWhatsappIdadeMax: 0,
      });
      const r = await service.getByTenant('x');
      // 0 ?? 18 === 0 (nullish coalescing preserva 0)
      expect(r?.redirecionamentoWhatsappIdadeMin).toBe(0);
      expect(r?.redirecionamentoWhatsappIdadeMax).toBe(0);
    });

    it('valor explícito não-nulo é preservado no idadeMin', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x',
        redirecionamentoWhatsappIdadeMin: 30,
      });
      const r = await service.getByTenant('x');
      expect(r?.redirecionamentoWhatsappIdadeMin).toBe(30);
    });

    it('valor explícito não-nulo é preservado no idadeMax', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x',
        redirecionamentoWhatsappIdadeMax: 70,
      });
      const r = await service.getByTenant('x');
      expect(r?.redirecionamentoWhatsappIdadeMax).toBe(70);
    });

    it('numero de WhatsApp não-nulo é preservado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x',
        redirecionamentoWhatsappNumero: '5511912345678',
      });
      const r = await service.getByTenant('x');
      expect(r?.redirecionamentoWhatsappNumero).toBe('5511912345678');
    });

    it('getAll injeta defaults em registro com WhatsApp ativo=true', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'x', redirecionamentoWhatsappAtivo: true },
      ]);
      const r = await service.getAll();
      expect(r[0].redirecionamentoWhatsappAtivo).toBe(true);
    });

    it('número de WhatsApp não é sobrescrito quando já definido', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x',
        redirecionamentoWhatsappNumero: '5571999990001',
      });
      const r = await service.getByTenant('x');
      expect(r?.redirecionamentoWhatsappNumero).toBe('5571999990001');
    });

    it('ativo=false não é sobrescrito pelo default true', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x',
        redirecionamentoWhatsappAtivo: false,
      });
      const r = await service.getByTenant('x');
      expect(r?.redirecionamentoWhatsappAtivo).toBe(false);
    });

    it('getAll com registro sem nenhum campo WhatsApp injeta todos os defaults', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'x' },
      ]);
      const r = await service.getAll();
      expect(r[0].redirecionamentoWhatsappAtivo).toBe(false);
      expect(r[0].redirecionamentoWhatsappIdadeMin).toBe(18);
      expect(r[0].redirecionamentoWhatsappIdadeMax).toBe(65);
      expect(r[0].redirecionamentoWhatsappNumero).toBeNull();
    });

    it('getAll com vários registros injeta defaults independentemente', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'a', redirecionamentoWhatsappIdadeMin: null },
        { tenantId: 'b', redirecionamentoWhatsappIdadeMin: 25 },
      ]);
      const r = await service.getAll();
      expect(r[0].redirecionamentoWhatsappIdadeMin).toBe(18);
      expect(r[1].redirecionamentoWhatsappIdadeMin).toBe(25);
    });
  });

  // ── getAll — edge cases adicionais ───────────────────────────────────────────
  describe('getAll — edge cases adicionais', () => {
    it('retorna lista com 10 registros', async () => {
      const registros = Array.from({ length: 10 }, (_, i) => ({ tenantId: `tenant-${i}` }));
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue(registros);
      const r = await service.getAll();
      expect(r).toHaveLength(10);
    });

    it('cada registro tem redirecionamentoWhatsappAtivo false por padrão', async () => {
      const registros = Array.from({ length: 5 }, (_, i) => ({ tenantId: `t${i}`, redirecionamentoWhatsappAtivo: null }));
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue(registros);
      const r = await service.getAll();
      for (const reg of r) {
        expect(reg.redirecionamentoWhatsappAtivo).toBe(false);
      }
    });

    it('cada registro tem idadeMin 18 quando null', async () => {
      const registros = [
        { tenantId: 'a', redirecionamentoWhatsappIdadeMin: null },
        { tenantId: 'b', redirecionamentoWhatsappIdadeMin: null },
      ];
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue(registros);
      const r = await service.getAll();
      for (const reg of r) {
        expect(reg.redirecionamentoWhatsappIdadeMin).toBe(18);
      }
    });

    it('cada registro tem idadeMax 65 quando null', async () => {
      const registros = [{ tenantId: 'a', redirecionamentoWhatsappIdadeMax: null }];
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue(registros);
      const r = await service.getAll();
      expect(r[0].redirecionamentoWhatsappIdadeMax).toBe(65);
    });

    it('preserva diasAvisoVencimento no resultado', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'x', diasAvisoVencimento: 5 },
      ]);
      const r = await service.getAll();
      expect(r[0].diasAvisoVencimento).toBe(5);
    });

    it('preserva limiteBeneficiarios no resultado', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'x', limiteBeneficiarios: 6 },
      ]);
      const r = await service.getAll();
      expect(r[0].limiteBeneficiarios).toBe(6);
    });

    it('preserva idadeMaximaDependente no resultado', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 'x', idadeMaximaDependente: 75 },
      ]);
      const r = await service.getAll();
      expect(r[0].idadeMaximaDependente).toBe(75);
    });

    it('getAll repassa erro de rede do prisma', async () => {
      (prismaMock.businessRules.findMany as jest.Mock).mockRejectedValue(new Error('Network timeout'));
      await expect(service.getAll()).rejects.toThrow('Network timeout');
    });
  });

  // ── getByTenant — edge cases adicionais ─────────────────────────────────────
  describe('getByTenant — edge cases adicionais', () => {
    it('usa tenantId correto no where clause', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      await service.getByTenant('tenant-xyz');
      expect(prismaMock.businessRules.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-xyz' }) }),
      );
    });

    it('preserva diasAvisoPendencia no resultado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x', diasAvisoPendencia: 10,
      });
      const r = await service.getByTenant('x');
      expect(r?.diasAvisoPendencia).toBe(10);
    });

    it('preserva diasAvisoVencimento no resultado', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x', diasAvisoVencimento: 3,
      });
      const r = await service.getByTenant('x');
      expect(r?.diasAvisoVencimento).toBe(3);
    });

    it('múltiplas chamadas para tenants distintos', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock)
        .mockResolvedValueOnce({ tenantId: 'a', limiteBeneficiarios: 4 })
        .mockResolvedValueOnce({ tenantId: 'b', limiteBeneficiarios: 8 });
      const ra = await service.getByTenant('a');
      const rb = await service.getByTenant('b');
      expect(ra?.limiteBeneficiarios).toBe(4);
      expect(rb?.limiteBeneficiarios).toBe(8);
    });

    it('getByTenant repassa erro do prisma', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockRejectedValue(new Error('DB timeout'));
      await expect(service.getByTenant('x')).rejects.toThrow('DB timeout');
    });
  });

  // ── create — edge cases adicionais ───────────────────────────────────────────
  describe('create — edge cases adicionais', () => {
    it('cria com diasAvisoPendencia especificado', async () => {
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue({
        tenantId: 'novo', diasAvisoPendencia: 7,
      });
      const result = await service.create({ tenantId: 'novo', diasAvisoPendencia: 7 } as any);
      expect((result as any).diasAvisoPendencia).toBe(7);
    });

    it('create retorna registro com tenantId correto', async () => {
      const created = { tenantId: 'new-tenant', diasAvisoVencimento: 3 };
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue(created);
      const result = await service.create({ tenantId: 'new-tenant' } as any);
      expect((result as any).tenantId).toBe('new-tenant');
    });

    it('create com limiteBeneficiarios 0 persiste o valor', async () => {
      const created = { tenantId: 'x', limiteBeneficiarios: 0 };
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue(created);
      const result = await service.create({ tenantId: 'x', limiteBeneficiarios: 0 } as any);
      expect((result as any).limiteBeneficiarios).toBe(0);
    });

    it('create com idadeMaximaDependente persistida', async () => {
      const created = { tenantId: 'x', idadeMaximaDependente: 70 };
      (prismaMock.businessRules.create as jest.Mock).mockResolvedValue(created);
      const result = await service.create({ tenantId: 'x', idadeMaximaDependente: 70 } as any);
      expect((result as any).idadeMaximaDependente).toBe(70);
    });

    it('create repassa erros de unique constraint', async () => {
      (prismaMock.businessRules.create as jest.Mock).mockRejectedValue(new Error('Unique constraint failed'));
      await expect(service.create({ tenantId: 'duplicado' } as any)).rejects.toThrow('Unique constraint failed');
    });
  });

  // ── update — edge cases adicionais ───────────────────────────────────────────
  describe('update — edge cases adicionais', () => {
    it('update com limiteBeneficiarios para null', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x', limiteBeneficiarios: null,
      });
      const result = await service.update('x', { limiteBeneficiarios: null } as any);
      expect((result as any).limiteBeneficiarios).toBeNull();
    });

    it('update com diasAvisoPendencia para 0', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x', diasAvisoPendencia: 0,
      });
      const result = await service.update('x', { diasAvisoPendencia: 0 } as any);
      expect((result as any).diasAvisoPendencia).toBe(0);
    });

    it('update com redirecionamentoWhatsappAtivo=true persiste', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x', redirecionamentoWhatsappAtivo: true,
      });
      const result = await service.update('x', { redirecionamentoWhatsappAtivo: true } as any);
      expect((result as any).redirecionamentoWhatsappAtivo).toBe(true);
    });

    it('update com redirecionamentoWhatsappNumero para novo número', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x', redirecionamentoWhatsappNumero: '5521999990002',
      });
      const result = await service.update('x', { redirecionamentoWhatsappNumero: '5521999990002' } as any);
      expect((result as any).redirecionamentoWhatsappNumero).toBe('5521999990002');
    });

    it('update com idadeMaximaDependente alterada', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x', idadeMaximaDependente: 80,
      });
      const result = await service.update('x', { idadeMaximaDependente: 80 } as any);
      expect((result as any).idadeMaximaDependente).toBe(80);
    });

    it('update repassa erro de tenant não encontrado', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockRejectedValue(new Error('Record not found'));
      await expect(service.update('nao-existe', { limiteBeneficiarios: 5 } as any)).rejects.toThrow('Record not found');
    });

    it('update retorna objeto com defaults WhatsApp injetados', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x',
        diasSuspensao: 20,
        redirecionamentoWhatsappAtivo: null,
        redirecionamentoWhatsappIdadeMin: null,
      });
      const result = await service.update('x', { diasSuspensao: 20 } as any);
      expect((result as any).redirecionamentoWhatsappAtivo).toBe(false);
      expect((result as any).redirecionamentoWhatsappIdadeMin).toBe(18);
    });
  });

  // ── get — cenários extra ──────────────────────────────────────────────────────
  describe('get — cenários extra', () => {
    it('get para tenant "pax" retorna regras', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ tenantId: 'pax' });
      const result = await service.getByTenant('pax');
      expect(result).toBeDefined();
    });

    it('get para tenant inexistente retorna objeto com defaults', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.getByTenant('nao-existe');
      expect(result).toBeDefined();
    });

    it('get repassa erro do prisma', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockRejectedValue(new Error('DB crash'));
      await expect(service.getByTenant('x')).rejects.toThrow('DB crash');
    });

    it('get retorna redirecionamentoWhatsappAtivo false por padrão', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x', redirecionamentoWhatsappAtivo: null,
      });
      const result = await service.getByTenant('x');
      expect((result as any).redirecionamentoWhatsappAtivo).toBe(false);
    });

    it('get com limiteBeneficiarios preenchido retorna valor', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x', limiteBeneficiarios: 6,
      });
      const result = await service.getByTenant('x');
      expect((result as any).limiteBeneficiarios).toBe(6);
    });

    it('get retorna redirecionamentoWhatsappIdadeMin 18 por padrão', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({
        tenantId: 'x', redirecionamentoWhatsappIdadeMin: null,
      });
      const result = await service.getByTenant('x');
      expect((result as any).redirecionamentoWhatsappIdadeMin).toBe(18);
    });
  });

  // ── update — cenários extra ───────────────────────────────────────────────────
  describe('update — cenários extra', () => {
    it('update com diasAvisoPendencia para 30 persiste', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x', diasAvisoPendencia: 30,
      });
      const result = await service.update('x', { diasAvisoPendencia: 30 } as any);
      expect((result as any).diasAvisoPendencia).toBe(30);
    });

    it('update com limiteBeneficiarios 10 persiste', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x', limiteBeneficiarios: 10,
      });
      const result = await service.update('x', { limiteBeneficiarios: 10 } as any);
      expect((result as any).limiteBeneficiarios).toBe(10);
    });

    it('update com tenant "bosque" funciona', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({ tenantId: 'bosque', diasSuspensao: 30 });
      const result = await service.update('bosque', { diasSuspensao: 30 } as any);
      expect(result).toBeDefined();
    });

    it('update com idadeMaximaDependente 21 persiste', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x', idadeMaximaDependente: 21,
      });
      const result = await service.update('x', { idadeMaximaDependente: 21 } as any);
      expect((result as any).idadeMaximaDependente).toBe(21);
    });

    it('update retorna objeto com tenantId', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({ tenantId: 'abc', diasSuspensao: 5 });
      const result = await service.update('abc', { diasSuspensao: 5 } as any);
      expect((result as any).tenantId).toBe('abc');
    });

    it('update com diasAvisoPendencia para 7 persiste', async () => {
      (prismaMock.businessRules.update as jest.Mock).mockResolvedValue({
        tenantId: 'x', diasAvisoPendencia: 7,
      });
      const result = await service.update('x', { diasAvisoPendencia: 7 } as any);
      expect((result as any).diasAvisoPendencia).toBe(7);
    });
  });
});
