import { FinanceiroService } from './financeiro.service';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
const prismaMock = {
  contaPagar: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  contaReceber: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  financialAudit: {
    create: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

jest.mock('./asaas-integration.service', () => ({
  AsaasIntegrationService: jest.fn().mockImplementation(() => ({
    ensurePaymentForContaReceber: jest.fn().mockResolvedValue(null),
  })),
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
    const expectedResult = {
      id: contaId,
      descricao: 'Receber 1',
      status: 'RECEBIDO',
      dataRecebimento: new Date(),
    };

    (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: contaId });
    (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue(expectedResult);

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
});
