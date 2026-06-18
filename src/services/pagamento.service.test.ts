const prismaMock = {
  pagamento: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: {
    validator: () => (value: unknown) => value,
  },
}));

import { PagamentoService } from './pagamento.service';

describe('PagamentoService', () => {
  let service: PagamentoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PagamentoService('tenant-123');
  });

  it('lista pagamentos com include do titular e plano', async () => {
    const rows = [
      {
        id: 1,
        titularId: 10,
        valor: 99.9,
        titular: {
          id: 10,
          nome: 'Cliente A',
          plano: { id: 2, nome: 'Plano Gold' },
        },
      },
    ];
    (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue(rows);

    const result = await service.getAll();

    expect(prismaMock.pagamento.findMany).toHaveBeenCalledWith({
      include: expect.objectContaining({
        titular: expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            nome: true,
            email: true,
            telefone: true,
            cpf: true,
            plano: expect.any(Object),
          }),
        }),
      }),
    });
    expect(result).toEqual(rows);
  });

  it('busca pagamento por id normalizando o valor numérico', async () => {
    const row = { id: 7, titularId: 2, valor: 50 };
    (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(row);

    const result = await service.getById('7' as unknown as number);

    expect(prismaMock.pagamento.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      include: expect.any(Object),
    });
    expect(result).toEqual(row);
  });

  it('cria novo pagamento quando não existe asaasPaymentId duplicado', async () => {
    const payload = {
      titularId: 10,
      valor: 150,
      dataPagamento: new Date('2026-06-18T00:00:00.000Z'),
      status: 'PENDENTE',
      metodoPagamento: 'PIX',
      asaasPaymentId: 'pay_new',
    };
    const created = { id: 100, ...payload };

    (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
    (prismaMock.pagamento.create as jest.Mock).mockResolvedValue(created);

    const result = await service.create(payload as any);

    expect(prismaMock.pagamento.findUnique).toHaveBeenCalledWith({
      where: { asaasPaymentId: 'pay_new' },
    });
    expect(prismaMock.pagamento.create).toHaveBeenCalledWith({
      data: payload,
    });
    expect(prismaMock.pagamento.update).not.toHaveBeenCalled();
    expect(result).toEqual(created);
  });

  it('atualiza pagamento existente quando o asaasPaymentId já está cadastrado', async () => {
    const payload = {
      titularId: 10,
      valor: 150,
      dataPagamento: new Date('2026-06-18T00:00:00.000Z'),
      status: 'RECEBIDO',
      metodoPagamento: 'PIX',
      asaasPaymentId: 'pay_existing',
    };
    const existing = { id: 42, asaasPaymentId: 'pay_existing' };
    const updated = { ...existing, ...payload };

    (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(existing);
    (prismaMock.pagamento.update as jest.Mock).mockResolvedValue(updated);

    const result = await service.create(payload as any);

    expect(prismaMock.pagamento.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: payload,
    });
    expect(prismaMock.pagamento.create).not.toHaveBeenCalled();
    expect(result).toEqual(updated);
  });

  it('atualiza e remove pagamento normalizando ids', async () => {
    const updated = { id: 8, status: 'CANCELADO' };
    const deleted = { id: 8 };
    (prismaMock.pagamento.update as jest.Mock).mockResolvedValue(updated);
    (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue(deleted);

    const resultUpdate = await service.update('8' as unknown as number, {
      status: 'CANCELADO',
    } as any);
    const resultDelete = await service.delete('8' as unknown as number);

    expect(prismaMock.pagamento.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { status: 'CANCELADO' },
    });
    expect(prismaMock.pagamento.delete).toHaveBeenCalledWith({
      where: { id: 8 },
    });
    expect(resultUpdate).toEqual(updated);
    expect(resultDelete).toEqual(deleted);
  });
});
