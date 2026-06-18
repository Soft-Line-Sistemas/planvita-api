import { FinanceiroService } from './financeiro.service';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
const prismaMock = {
  contaPagar: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  contaReceber: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
  pagamento: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  comissao: {
    updateMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  financialAudit: {
    create: jest.fn(),
  },
  titular: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

const mockAsaasIntegration = {
  ensurePaymentForContaReceber: jest.fn().mockResolvedValue(null),
  syncRecurringPaymentsForTitular: jest.fn().mockResolvedValue({
    processed: 0,
    inserted: 0,
    updated: 0,
  }),
  refreshPaymentStatus: jest.fn().mockImplementation(async (contaId: number) => ({
    id: contaId,
  })),
  confirmPaymentForContaReceber: jest.fn().mockResolvedValue(undefined),
  revertPaymentForContaReceber: jest.fn().mockResolvedValue(undefined),
  deletePaymentForContaReceber: jest.fn().mockResolvedValue(undefined),
  updatePaymentForContaReceber: jest.fn().mockResolvedValue(undefined),
  isEnabled: jest.fn().mockReturnValue(true),
  listSubscriptionsFromProvider: jest.fn().mockResolvedValue([]),
  syncRecurringPaymentsFromProvider: jest
    .fn()
    .mockResolvedValue({ processed: 0, inserted: 0, updated: 0 }),
  ensureMonthlySubscriptionForTitular: jest.fn().mockResolvedValue('sub_new_123'),
};

jest.mock('./asaas-integration.service', () => ({
  AsaasIntegrationService: jest.fn().mockImplementation(() => mockAsaasIntegration),
}));

describe('FinanceiroService', () => {
  let service: FinanceiroService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FinanceiroService('tenant-123');
  });

  it('should create a conta pagar', async () => {
    const input = {
      descricao: 'Teste',
      valor: 100,
      vencimento: new Date(),
      fornecedor: 'Fornecedor X',
    };

    const expectedResult = {
      id: 1,
      ...input,
      status: 'PENDENTE',
    };

    (prismaMock.contaPagar.create as jest.Mock).mockResolvedValue(expectedResult);

    const result = await service.criarContaPagar(input, 1);

    expect(prismaMock.contaPagar.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        descricao: input.descricao,
        valor: input.valor,
      }),
    });
    expect(result).toEqual({ ...expectedResult, tipo: 'Pagar' });
    expect(prismaMock.financialAudit.create).toHaveBeenCalled();
  });

  it('should list all contas', async () => {
    (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([
      { id: 1, descricao: 'Pagar 1', valor: 50, tipo: 'Pagar' },
    ]);
    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
      { id: 2, descricao: 'Receber 1', valor: 150, tipo: 'Receber' },
    ]);

    const result = await service.listarContas();

    expect(result).toHaveLength(2);
    expect(result[0].tipo).toBe('Pagar');
    expect(result[1].tipo).toBe('Receber');
  });

  it('should create a conta receber', async () => {
    const input = {
      descricao: 'Recebimento Teste',
      valor: 200,
      vencimento: new Date(),
      clienteId: 10,
      integrarAsaas: true,
    };

    const expectedResult = {
      id: 2,
      ...input,
      status: 'PENDENTE',
      cliente: { id: 10, nome: 'Cliente Teste' },
    };

    (prismaMock.contaReceber.create as jest.Mock).mockResolvedValue(expectedResult);
    
    // We can't easily spy on the private asaasIntegration instance method directly from here 
    // without more complex mocking, but we verify the service calls prisma correctly.
    
    const result = await service.criarContaReceber(input, 1);

    expect(prismaMock.contaReceber.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        descricao: input.descricao,
        valor: input.valor,
        clienteId: input.clienteId,
      }),
      include: expect.any(Object),
    });
    expect(result).toEqual({ ...expectedResult, tipo: 'Receber' });
    expect(prismaMock.financialAudit.create).toHaveBeenCalled();
  });

  it('should list contas only for the authenticated client', async () => {
    const titularId = 10;
    const contasMock = [
      {
        id: 3,
        descricao: 'Mensalidade Maio',
        valor: 199.9,
        vencimento: new Date('2026-05-10T00:00:00.000Z'),
        status: 'PENDENTE',
        paymentUrl: 'https://asaas.com/p/123',
        pixQrCode: '000201010212...',
        asaasPaymentId: 'pay_123',
        asaasSubscriptionId: 'sub_456',
      },
      {
        id: 2,
        descricao: 'Mensalidade Abril',
        valor: 199.9,
        vencimento: new Date('2026-04-10T00:00:00.000Z'),
        status: 'RECEBIDO',
        paymentUrl: null,
        pixQrCode: null,
        asaasPaymentId: null,
        asaasSubscriptionId: 'sub_456',
      },
    ];

    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue(contasMock);
    (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.listarContasDoCliente(titularId);

    expect(prismaMock.contaReceber.findMany).toHaveBeenCalledWith({
      where: {
        clienteId: titularId,
        OR: [
          { status: { in: ['PENDENTE', 'VENCIDO', 'ATRASADO'] } },
          {
            status: { in: ['PAGO', 'RECEBIDO', 'CONFIRMADO', 'CANCELADO'] },
            vencimento: { gte: expect.any(Date) },
          },
        ],
      },
      orderBy: [{ vencimento: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        descricao: true,
        valor: true,
        vencimento: true,
        status: true,
        paymentUrl: true,
        pixQrCode: true,
        asaasPaymentId: true,
        asaasSubscriptionId: true,
      },
    });
    expect(result).toEqual([
      { ...contasMock[0], tipo: 'Receber' },
      { ...contasMock[1], tipo: 'Receber' },
    ]);
  });

  it('should settle (baixar) a conta pagar', async () => {
    const contaId = 1;
    const expectedResult = {
      id: contaId,
      descricao: 'Pagar 1',
      status: 'PAGO',
      dataPagamento: new Date(),
    };

    (prismaMock.contaPagar.update as jest.Mock).mockResolvedValue(expectedResult);

    const result = await service.baixarConta('Pagar', contaId, 1);

    expect(prismaMock.contaPagar.update).toHaveBeenCalledWith({
      where: { id: contaId },
      data: {
        status: 'PAGO',
        dataPagamento: expect.any(Date),
      },
    });
    expect(result.status).toBe('PAGO');
    expect(prismaMock.financialAudit.create).toHaveBeenCalled();
  });

  it('should settle (baixar) a conta receber', async () => {
    const contaId = 2;
    const gerarComissaoSpy = jest
      .spyOn(service as any, 'gerarComissaoPrimeiroPagamento')
      .mockResolvedValue(undefined);
    const expectedResult = {
      id: contaId,
      descricao: 'Receber 1',
      valor: 150,
      vencimento: new Date('2026-01-30T00:00:00.000Z'),
      dataVencimento: new Date('2026-01-30T00:00:00.000Z'),
      metodoPagamento: 'Boleto',
      status: 'RECEBIDO',
      dataRecebimento: new Date(),
      cliente: {
        id: 10,
        nome: 'Cliente Teste',
        email: 'teste@planvita.com',
        telefone: '11999999999',
        cpf: '12345678901',
      },
    };

    (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
      id: contaId,
      status: 'PENDENTE',
    });
    (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue(expectedResult);
    (prismaMock.pagamento.findFirst as jest.Mock).mockResolvedValue(null);
    (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({
      id: 100,
      titularId: 10,
      status: 'RECEBIDO',
    });

    const result = await service.baixarConta('Receber', contaId, 1);

    expect(prismaMock.contaReceber.update).toHaveBeenCalledWith({
      where: { id: contaId },
      data: {
        status: 'RECEBIDO',
        dataRecebimento: expect.any(Date),
      },
      include: expect.any(Object),
    });
    expect(result.status).toBe('RECEBIDO');
    expect(prismaMock.pagamento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        titularId: 10,
        status: 'RECEBIDO',
        valor: 150,
      }),
    });
    expect(gerarComissaoSpy).toHaveBeenCalledWith(10);
    expect(prismaMock.financialAudit.create).toHaveBeenCalled();
  });

  it('should treat an already received conta receber as an idempotent baixa', async () => {
    const contaId = 38;
    const gerarComissaoSpy = jest
      .spyOn(service as any, 'gerarComissaoPrimeiroPagamento')
      .mockResolvedValue(undefined);
    const expectedResult = {
      id: contaId,
      descricao: 'Receber já baixado',
      valor: 150,
      vencimento: new Date('2026-01-30T00:00:00.000Z'),
      status: 'RECEBIDO',
      dataRecebimento: new Date('2026-05-12T21:30:00.000Z'),
      asaasPaymentId: 'pay_q29ufly32ci7e0ot',
      cliente: {
        id: 10,
        nome: 'Cliente Teste',
        email: 'teste@planvita.com',
        telefone: '11999999999',
        cpf: '12345678901',
      },
    };

    (prismaMock.contaReceber.findUnique as jest.Mock)
      .mockResolvedValueOnce({
        id: contaId,
        status: 'RECEBIDO',
        asaasPaymentId: 'pay_q29ufly32ci7e0ot',
      })
      .mockResolvedValueOnce(expectedResult);

    const result = await service.baixarConta('Receber', contaId, 1);

    expect(mockAsaasIntegration.confirmPaymentForContaReceber).not.toHaveBeenCalled();
    expect(prismaMock.contaReceber.update).not.toHaveBeenCalled();
    expect(prismaMock.pagamento.upsert).not.toHaveBeenCalled();
    expect(result.status).toBe('RECEBIDO');
    expect(gerarComissaoSpy).toHaveBeenCalledWith(10);
    expect(prismaMock.financialAudit.create).toHaveBeenCalled();
  });

  it('should chargeback (estornar) a conta pagar', async () => {
    const contaId = 1;
    const expectedResult = {
      id: contaId,
      descricao: 'Pagar 1',
      status: 'CANCELADO',
      dataPagamento: null,
    };

    (prismaMock.contaPagar.update as jest.Mock).mockResolvedValue(expectedResult);

    const result = await service.estornarConta('Pagar', contaId, 1);

    expect(prismaMock.contaPagar.update).toHaveBeenCalledWith({
      where: { id: contaId },
      data: {
        status: 'CANCELADO',
        dataPagamento: null,
      },
    });
    expect(result.status).toBe('CANCELADO');
    expect(prismaMock.financialAudit.create).toHaveBeenCalled();
  });

  it('should chargeback (estornar) a conta receber and sync payment history', async () => {
    const contaId = 3;
    const expectedResult = {
      id: contaId,
      descricao: 'Receber 2',
      valor: 220,
      vencimento: new Date('2026-02-10T00:00:00.000Z'),
      dataVencimento: new Date('2026-02-10T00:00:00.000Z'),
      metodoPagamento: 'Boleto',
      status: 'CANCELADO',
      dataRecebimento: null,
      cliente: {
        id: 11,
        nome: 'Cliente Estorno',
        email: 'estorno@planvita.com',
        telefone: '11988888888',
        cpf: '10987654321',
      },
    };

    (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
      id: contaId,
      status: 'RECEBIDO',
    });
    (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue(expectedResult);
    (prismaMock.pagamento.findFirst as jest.Mock).mockResolvedValue({
      id: 200,
    });
    (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({
      id: 200,
      status: 'CANCELADO',
    });

    const result = await service.estornarConta('Receber', contaId, 1);

    expect(prismaMock.contaReceber.update).toHaveBeenCalledWith({
      where: { id: contaId },
      data: {
        status: 'CANCELADO',
        dataRecebimento: null,
      },
      include: expect.any(Object),
    });
    expect(prismaMock.pagamento.update).toHaveBeenCalledWith({
      where: { id: 200 },
      data: expect.objectContaining({
        status: 'CANCELADO',
      }),
    });
    expect(result.status).toBe('CANCELADO');
    expect(prismaMock.financialAudit.create).toHaveBeenCalled();
  });

  it('should fallback paymentUrl and pixQrCode from pagamento history when conta is missing them', async () => {
    const titularId = 55;
    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
      {
        id: 10,
        descricao: 'Mensalidade',
        valor: 120,
        vencimento: new Date('2026-06-20T00:00:00.000Z'),
        status: 'PENDENTE',
        paymentUrl: null,
        pixQrCode: null,
        asaasPaymentId: 'pay_hist_1',
        asaasSubscriptionId: 'sub_1',
      },
    ]);
    (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([
      {
        asaasPaymentId: 'pay_hist_1',
        paymentUrl: 'https://asaas.com/i/pay_hist_1',
        pixQrCode: '000201fallback',
      },
    ]);

    const result = await service.listarContasDoCliente(titularId);

    expect(result).toEqual([
      expect.objectContaining({
        id: 10,
        paymentUrl: 'https://asaas.com/i/pay_hist_1',
        pixQrCode: '000201fallback',
        tipo: 'Receber',
      }),
    ]);
  });

  it('should summarize recurring charges with dependente adicionais and provider references', async () => {
    (prismaMock.titular.findMany as jest.Mock).mockResolvedValue([
      {
        id: 1,
        nome: 'Ana',
        plano: { valorMensal: 100 },
        dependentes: [{ valorAdicionalMensal: 9.9 }, { valorAdicionalMensal: 14.9 }],
      },
      {
        id: 2,
        nome: 'Bruno',
        plano: { valorMensal: 80 },
        dependentes: [],
      },
    ]);
    (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
      {
        clienteId: 1,
        status: 'PENDENTE',
        valor: 124.8,
        dataVencimento: new Date('2026-07-10T00:00:00.000Z'),
        vencimento: null,
        asaasSubscriptionId: 'sub_local_1',
        cliente: { id: 1, nome: 'Ana' },
      },
    ]);
    (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([
      {
        titularId: 1,
        status: 'RECEBIDO',
        dataPagamento: new Date('2026-06-05T00:00:00.000Z'),
        asaasSubscriptionId: 'sub_local_1',
        titular: { id: 1, nome: 'Ana' },
      },
      {
        titularId: 2,
        status: 'RECEBIDO',
        dataPagamento: new Date('2026-05-05T00:00:00.000Z'),
        asaasSubscriptionId: 'sub_provider_2',
        titular: { id: 2, nome: 'Bruno' },
      },
    ]);
    mockAsaasIntegration.listSubscriptionsFromProvider.mockResolvedValue([
      { id: 'sub_provider_1', externalReference: 'titular-1' },
      { id: 'sub_provider_2', externalReference: 'titular-2' },
    ]);

    const result = await service.listarRecorrencias();

    expect(result).toEqual([
      expect.objectContaining({
        titularId: 1,
        clienteNome: 'Ana',
        valorAtual: 124.8,
        aberto: true,
        totalPagas: 1,
        asaasSubscriptionId: 'sub_local_1',
        asaasSubscriptionIdLocal: 'sub_local_1',
        asaasSubscriptionIdProvider: 'sub_provider_1',
        temReferenciaLocal: true,
        temReferenciaAsaas: true,
      }),
      expect.objectContaining({
        titularId: 2,
        clienteNome: 'Bruno',
        valorAtual: 80,
        aberto: false,
        totalPagas: 1,
        asaasSubscriptionId: 'sub_provider_2',
        asaasSubscriptionIdProvider: 'sub_provider_2',
        temReferenciaAsaas: true,
      }),
    ]);
  });

  it('should generate recurring billing using plano value plus beneficiarios adicionais', async () => {
    const syncSpy = jest
      .spyOn(service, 'sincronizarRecorrenciasAsaas')
      .mockResolvedValue({ processed: 0, inserted: 0, updated: 0 });

    (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
      id: 9,
      nome: 'Cliente Recorrente',
      plano: { valorMensal: 100 },
      dependentes: [{ valorAdicionalMensal: 9.9 }, { valorAdicionalMensal: 10 }],
    });

    const result = await service.gerarRecorrenciaParaTitular(9, 'BOLETO');

    expect(mockAsaasIntegration.ensureMonthlySubscriptionForTitular).toHaveBeenCalledWith({
      titularId: 9,
      valorMensal: 119.9,
      descricao: 'Mensalidade Plano - Cliente Recorrente',
      billingType: 'BOLETO',
    });
    expect(syncSpy).toHaveBeenCalled();
    expect(result).toEqual({
      titularId: 9,
      asaasSubscriptionId: 'sub_new_123',
      billingType: 'BOLETO',
    });
  });
});
