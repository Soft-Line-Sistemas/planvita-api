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
        tenantId: 'tenant-123',
        diasSuspensao: 75,
        redirecionamentoWhatsappAtivo: true,
        redirecionamentoWhatsappNumero: '5511999999999',
        redirecionamentoWhatsappIdadeMin: 18,
        redirecionamentoWhatsappIdadeMax: 65,
      },
      select: expect.any(Object),
    });
  });
});
