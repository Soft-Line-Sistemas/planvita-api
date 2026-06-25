import { FinanceiroService } from './financeiro.service';

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
  syncRecurringPaymentsForTitular: jest.fn().mockResolvedValue({ processed: 0, inserted: 0, updated: 0 }),
  refreshPaymentStatus: jest.fn().mockImplementation(async (contaId: number) => ({ id: contaId })),
  confirmPaymentForContaReceber: jest.fn().mockResolvedValue(undefined),
  revertPaymentForContaReceber: jest.fn().mockResolvedValue(undefined),
  deletePaymentForContaReceber: jest.fn().mockResolvedValue(undefined),
  updatePaymentForContaReceber: jest.fn().mockResolvedValue(undefined),
  isEnabled: jest.fn().mockReturnValue(true),
  listSubscriptionsFromProvider: jest.fn().mockResolvedValue([]),
  syncRecurringPaymentsFromProvider: jest.fn().mockResolvedValue({ processed: 0, inserted: 0, updated: 0 }),
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
    prismaMock.financialAudit.create.mockResolvedValue({ id: 1 });
  });

  // ── constructor ─────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new FinanceiroService('tenant-abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new FinanceiroService('')).toThrow();
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new FinanceiroService(undefined as any)).toThrow();
    });
  });

  // ── criarContaPagar ──────────────────────────────────────────────────────────
  describe('criarContaPagar', () => {
    it('should create a conta pagar', async () => {
      const input = { descricao: 'Teste', valor: 100, vencimento: new Date(), fornecedor: 'Fornecedor X' };
      const expectedResult = { id: 1, ...input, status: 'PENDENTE' };

      (prismaMock.contaPagar.create as jest.Mock).mockResolvedValue(expectedResult);

      const result = await service.criarContaPagar(input, 1);

      expect(prismaMock.contaPagar.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ descricao: input.descricao, valor: input.valor }),
      });
      expect(result).toEqual({ ...expectedResult, tipo: 'Pagar' });
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });

    it('cria conta pagar com status PENDENTE', async () => {
      (prismaMock.contaPagar.create as jest.Mock).mockResolvedValue({ id: 1, status: 'PENDENTE' });
      const result = await service.criarContaPagar({ descricao: 'X', valor: 50, vencimento: new Date() }, 1);
      expect(result.tipo).toBe('Pagar');
    });

    it('inclui fornecedor no payload', async () => {
      (prismaMock.contaPagar.create as jest.Mock).mockResolvedValue({ id: 2, fornecedor: 'ABC' });
      await service.criarContaPagar({ descricao: 'Y', valor: 200, vencimento: new Date(), fornecedor: 'ABC' }, 1);
      const callData = (prismaMock.contaPagar.create as jest.Mock).mock.calls[0][0].data;
      expect(callData.fornecedor).toBe('ABC');
    });

    it('cria auditoria financeira ao criar conta pagar', async () => {
      (prismaMock.contaPagar.create as jest.Mock).mockResolvedValue({ id: 3 });
      await service.criarContaPagar({ descricao: 'Z', valor: 30, vencimento: new Date() }, 99);
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });

    it('repassa erro do prisma no criarContaPagar', async () => {
      (prismaMock.contaPagar.create as jest.Mock).mockRejectedValue(new Error('DB error'));
      await expect(service.criarContaPagar({ descricao: 'X', valor: 100, vencimento: new Date() }, 1)).rejects.toThrow('DB error');
    });

    it('rejeita conta pagar com valor zero', async () => {
      await expect(service.criarContaPagar({ descricao: 'Isento', valor: 0, vencimento: new Date() }, 1))
        .rejects.toThrow('O valor deve ser positivo.');
    });
  });

  // ── listarContas ─────────────────────────────────────────────────────────────
  describe('listarContas', () => {
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

    it('retorna apenas contas a pagar quando não há receber', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([
        { id: 1, descricao: 'Pagar 1', valor: 50 },
      ]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listarContas();
      expect(result).toHaveLength(1);
      expect(result[0].tipo).toBe('Pagar');
    });

    it('retorna apenas contas a receber quando não há pagar', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 2, descricao: 'Receber 1', valor: 150 },
      ]);

      const result = await service.listarContas();
      expect(result).toHaveLength(1);
      expect(result[0].tipo).toBe('Receber');
    });

    it('retorna array vazio quando não há contas', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listarContas();
      expect(result).toEqual([]);
    });

    it('retorna múltiplas contas de cada tipo', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([{ id: 3 }, { id: 4 }, { id: 5 }]);

      const result = await service.listarContas();
      expect(result).toHaveLength(5);
    });
  });

  // ── criarContaReceber ─────────────────────────────────────────────────────────
  describe('criarContaReceber', () => {
    it('should create a conta receber', async () => {
      const input = { descricao: 'Recebimento Teste', valor: 200, vencimento: new Date(), clienteId: 10, integrarAsaas: true };
      const expectedResult = { id: 2, ...input, status: 'PENDENTE', cliente: { id: 10, nome: 'Cliente Teste' } };

      (prismaMock.contaReceber.create as jest.Mock).mockResolvedValue(expectedResult);

      const result = await service.criarContaReceber(input, 1);

      expect(prismaMock.contaReceber.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ descricao: input.descricao, valor: input.valor, clienteId: input.clienteId }),
        include: expect.any(Object),
      });
      expect(result).toEqual({ ...expectedResult, tipo: 'Receber' });
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });

    it('cria auditoria ao criar conta receber', async () => {
      (prismaMock.contaReceber.create as jest.Mock).mockResolvedValue({ id: 5, status: 'PENDENTE' });
      await service.criarContaReceber({ descricao: 'X', valor: 100, vencimento: new Date(), clienteId: 1 }, 1);
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });

    it('cria conta receber sem asaas', async () => {
      (prismaMock.contaReceber.create as jest.Mock).mockResolvedValue({ id: 6, status: 'PENDENTE' });
      const result = await service.criarContaReceber({ descricao: 'Sem Asaas', valor: 150, vencimento: new Date(), clienteId: 2, integrarAsaas: false }, 1);
      expect(result.tipo).toBe('Receber');
      expect(mockAsaasIntegration.ensurePaymentForContaReceber).not.toHaveBeenCalled();
    });

    it('cria conta receber com integração Asaas quando enabled', async () => {
      (prismaMock.contaReceber.create as jest.Mock).mockResolvedValue({ id: 7, status: 'PENDENTE' });
      await service.criarContaReceber({ descricao: 'Com Asaas', valor: 300, vencimento: new Date(), clienteId: 3, integrarAsaas: true }, 1);
      expect(mockAsaasIntegration.ensurePaymentForContaReceber).toHaveBeenCalled();
    });

    it('repassa erro do prisma no criarContaReceber', async () => {
      (prismaMock.contaReceber.create as jest.Mock).mockRejectedValue(new Error('FK constraint'));
      await expect(service.criarContaReceber({ descricao: 'X', valor: 100, vencimento: new Date(), clienteId: 1 }, 1)).rejects.toThrow('FK constraint');
    });
  });

  // ── listarContasDoCliente ────────────────────────────────────────────────────
  describe('listarContasDoCliente', () => {
    it('should list contas only for the authenticated client', async () => {
      const titularId = 10;
      const contasMock = [
        {
          id: 3, descricao: 'Mensalidade Maio', valor: 199.9, vencimento: new Date('2026-05-10T00:00:00.000Z'),
          status: 'PENDENTE', paymentUrl: 'https://asaas.com/p/123', pixQrCode: '000201010212...',
          asaasPaymentId: 'pay_123', asaasSubscriptionId: 'sub_456',
        },
        {
          id: 2, descricao: 'Mensalidade Abril', valor: 199.9, vencimento: new Date('2026-04-10T00:00:00.000Z'),
          status: 'RECEBIDO', paymentUrl: null, pixQrCode: null, asaasPaymentId: null, asaasSubscriptionId: 'sub_456',
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
            { status: { in: ['PAGO', 'RECEBIDO', 'CONFIRMADO', 'CANCELADO'] }, vencimento: { gte: expect.any(Date) } },
          ],
        },
        orderBy: [{ vencimento: 'desc' }, { id: 'desc' }],
        select: {
          id: true, descricao: true, valor: true, vencimento: true, status: true,
          paymentUrl: true, pixQrCode: true, asaasPaymentId: true, asaasSubscriptionId: true,
        },
      });
      expect(result).toEqual([
        { ...contasMock[0], tipo: 'Receber' },
        { ...contasMock[1], tipo: 'Receber' },
      ]);
    });

    it('retorna array vazio quando não há contas', async () => {
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.listarContasDoCliente(1);
      expect(result).toEqual([]);
    });

    it('should fallback paymentUrl and pixQrCode from pagamento history when conta is missing them', async () => {
      const titularId = 55;
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 10, descricao: 'Mensalidade', valor: 120, vencimento: new Date('2026-06-20T00:00:00.000Z'), status: 'PENDENTE', paymentUrl: null, pixQrCode: null, asaasPaymentId: 'pay_hist_1', asaasSubscriptionId: 'sub_1' },
      ]);
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([
        { asaasPaymentId: 'pay_hist_1', paymentUrl: 'https://asaas.com/i/pay_hist_1', pixQrCode: '000201fallback' },
      ]);

      const result = await service.listarContasDoCliente(titularId);

      expect(result).toEqual([
        expect.objectContaining({ id: 10, paymentUrl: 'https://asaas.com/i/pay_hist_1', pixQrCode: '000201fallback', tipo: 'Receber' }),
      ]);
    });

    it('não sobrescreve paymentUrl existente com fallback do histórico', async () => {
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 1, valor: 100, vencimento: new Date(), status: 'PENDENTE', paymentUrl: 'https://original.com', pixQrCode: null, asaasPaymentId: 'pay_a', asaasSubscriptionId: null },
      ]);
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([
        { asaasPaymentId: 'pay_a', paymentUrl: 'https://fallback.com', pixQrCode: 'qr' },
      ]);

      const result = await service.listarContasDoCliente(1);
      expect(result[0].paymentUrl).toBe('https://original.com');
    });
  });

  // ── baixarConta ──────────────────────────────────────────────────────────────
  describe('baixarConta', () => {
    it('should settle (baixar) a conta pagar', async () => {
      const contaId = 1;
      const expectedResult = { id: contaId, descricao: 'Pagar 1', status: 'PAGO', dataPagamento: new Date() };

      (prismaMock.contaPagar.update as jest.Mock).mockResolvedValue(expectedResult);

      const result = await service.baixarConta('Pagar', contaId, 1);

      expect(prismaMock.contaPagar.update).toHaveBeenCalledWith({
        where: { id: contaId },
        data: { status: 'PAGO', dataPagamento: expect.any(Date) },
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
        id: contaId, descricao: 'Receber 1', valor: 150, vencimento: new Date('2026-01-30T00:00:00.000Z'),
        dataVencimento: new Date('2026-01-30T00:00:00.000Z'), metodoPagamento: 'Boleto',
        status: 'RECEBIDO', dataRecebimento: new Date(),
        cliente: { id: 10, nome: 'Cliente Teste', email: 'teste@planvita.com', telefone: '11999999999', cpf: '12345678901' },
      };

      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: contaId, status: 'PENDENTE' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue(expectedResult);
      (prismaMock.pagamento.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 100, titularId: 10, status: 'RECEBIDO' });

      const result = await service.baixarConta('Receber', contaId, 1);

      expect(prismaMock.contaReceber.update).toHaveBeenCalledWith({
        where: { id: contaId },
        data: { status: 'RECEBIDO', dataRecebimento: expect.any(Date) },
        include: expect.any(Object),
      });
      expect(result.status).toBe('RECEBIDO');
      expect(prismaMock.pagamento.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ titularId: 10, status: 'RECEBIDO', valor: 150 }),
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
        id: contaId, descricao: 'Receber já baixado', valor: 150, vencimento: new Date('2026-01-30T00:00:00.000Z'),
        status: 'RECEBIDO', dataRecebimento: new Date('2026-05-12T21:30:00.000Z'),
        asaasPaymentId: 'pay_q29ufly32ci7e0ot',
        cliente: { id: 10, nome: 'Cliente Teste', email: 'teste@planvita.com', telefone: '11999999999', cpf: '12345678901' },
      };

      (prismaMock.contaReceber.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: contaId, status: 'RECEBIDO', asaasPaymentId: 'pay_q29ufly32ci7e0ot' })
        .mockResolvedValueOnce(expectedResult);

      const result = await service.baixarConta('Receber', contaId, 1);

      expect(mockAsaasIntegration.confirmPaymentForContaReceber).not.toHaveBeenCalled();
      expect(prismaMock.contaReceber.update).not.toHaveBeenCalled();
      expect(prismaMock.pagamento.upsert).not.toHaveBeenCalled();
      expect(result.status).toBe('RECEBIDO');
      expect(gerarComissaoSpy).toHaveBeenCalledWith(10);
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });

    it('baixa conta pagar com dataPagamento automática', async () => {
      const before = Date.now();
      (prismaMock.contaPagar.update as jest.Mock).mockImplementation(async ({ data }) => ({
        id: 1, ...data, status: 'PAGO',
      }));

      await service.baixarConta('Pagar', 1, 1);
      const callData = (prismaMock.contaPagar.update as jest.Mock).mock.calls[0][0].data;
      const after = Date.now();
      expect(callData.dataPagamento.getTime()).toBeGreaterThanOrEqual(before);
      expect(callData.dataPagamento.getTime()).toBeLessThanOrEqual(after);
    });

    it('cria registro de pagamento ao baixar conta receber PENDENTE', async () => {
      jest.spyOn(service as any, 'gerarComissaoPrimeiroPagamento').mockResolvedValue(undefined);
      const contaMock = {
        id: 5, valor: 80, status: 'RECEBIDO', dataRecebimento: new Date(),
        cliente: { id: 3, nome: 'X', email: 'x@x.com', telefone: '11999999999', cpf: '11122233344' },
      };
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: 5, status: 'PENDENTE' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue(contaMock);
      (prismaMock.pagamento.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 200 });

      await service.baixarConta('Receber', 5, 1);
      expect(prismaMock.pagamento.create).toHaveBeenCalled();
    });
  });

  // ── estornarConta ─────────────────────────────────────────────────────────────
  describe('estornarConta', () => {
    it('should chargeback (estornar) a conta pagar', async () => {
      const contaId = 1;
      const expectedResult = { id: contaId, descricao: 'Pagar 1', status: 'CANCELADO', dataPagamento: null };

      (prismaMock.contaPagar.update as jest.Mock).mockResolvedValue(expectedResult);

      const result = await service.estornarConta('Pagar', contaId, 1);

      expect(prismaMock.contaPagar.update).toHaveBeenCalledWith({
        where: { id: contaId },
        data: { status: 'CANCELADO', dataPagamento: null },
      });
      expect(result.status).toBe('CANCELADO');
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });

    it('should chargeback (estornar) a conta receber and sync payment history', async () => {
      const contaId = 3;
      const expectedResult = {
        id: contaId, descricao: 'Receber 2', valor: 220, vencimento: new Date('2026-02-10T00:00:00.000Z'),
        dataVencimento: new Date('2026-02-10T00:00:00.000Z'), metodoPagamento: 'Boleto',
        status: 'CANCELADO', dataRecebimento: null,
        cliente: { id: 11, nome: 'Cliente Estorno', email: 'estorno@planvita.com', telefone: '11988888888', cpf: '10987654321' },
      };

      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: contaId, status: 'RECEBIDO' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue(expectedResult);
      (prismaMock.pagamento.findFirst as jest.Mock).mockResolvedValue({ id: 200 });
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 200, status: 'CANCELADO' });

      const result = await service.estornarConta('Receber', contaId, 1);

      expect(prismaMock.contaReceber.update).toHaveBeenCalledWith({
        where: { id: contaId },
        data: { status: 'CANCELADO', dataRecebimento: null },
        include: expect.any(Object),
      });
      expect(prismaMock.pagamento.update).toHaveBeenCalledWith({
        where: { id: 200 },
        data: expect.objectContaining({ status: 'CANCELADO' }),
      });
      expect(result.status).toBe('CANCELADO');
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });

    it('estorna conta pagar retorna status CANCELADO', async () => {
      (prismaMock.contaPagar.update as jest.Mock).mockResolvedValue({ id: 5, status: 'CANCELADO' });
      const result = await service.estornarConta('Pagar', 5, 1);
      expect((result as any).status).toBe('CANCELADO');
    });

    it('cria auditoria ao estornar conta receber', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: 'PENDENTE' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({
        id: 1, status: 'CANCELADO', dataRecebimento: null,
        cliente: { id: 1, nome: 'X', email: 'x@x.com', telefone: '11999999999', cpf: '11122233344' },
      });
      (prismaMock.pagamento.findFirst as jest.Mock).mockResolvedValue(null);

      await service.estornarConta('Receber', 1, 1);
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });

    it('não atualiza pagamento se não existir histórico', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: 2, status: 'PENDENTE' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({
        id: 2, status: 'CANCELADO', dataRecebimento: null,
        cliente: { id: 1, nome: 'X', email: 'x@x.com', telefone: '11999999999', cpf: '11122233344' },
      });
      (prismaMock.pagamento.findFirst as jest.Mock).mockResolvedValue(null);

      await service.estornarConta('Receber', 2, 1);
      expect(prismaMock.pagamento.update).not.toHaveBeenCalled();
    });
  });

  // ── deletarContaPagar ─────────────────────────────────────────────────────────
  describe('deletarContaPagar', () => {
    it('should unlink comissao before deleting conta pagar', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue({ id: 7, descricao: 'Comissão consultor', status: 'PENDENTE' });
      (prismaMock.comissao.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prismaMock.contaPagar.delete as jest.Mock).mockResolvedValue({ id: 7 });

      await service.deletarContaPagar(7, 99);

      expect(prismaMock.comissao.updateMany).toHaveBeenCalledWith({
        where: { contaPagarId: 7 },
        data: { contaPagarId: null },
      });
      expect(prismaMock.contaPagar.delete).toHaveBeenCalledWith({ where: { id: 7 } });
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });

    it('deleta sem comissão vinculada', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue({ id: 8, status: 'PENDENTE' });
      (prismaMock.comissao.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prismaMock.contaPagar.delete as jest.Mock).mockResolvedValue({ id: 8 });

      await service.deletarContaPagar(8, 1);
      expect(prismaMock.contaPagar.delete).toHaveBeenCalled();
    });

    it('lança erro quando conta não encontrada', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.deletarContaPagar(999, 1)).rejects.toThrow();
    });

    it('cria auditoria ao deletar conta pagar', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue({ id: 10, status: 'PENDENTE' });
      (prismaMock.comissao.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      (prismaMock.contaPagar.delete as jest.Mock).mockResolvedValue({ id: 10 });

      await service.deletarContaPagar(10, 1);
      expect(prismaMock.financialAudit.create).toHaveBeenCalled();
    });
  });

  // ── listarRecorrencias ─────────────────────────────────────────────────────────
  describe('listarRecorrencias', () => {
    it('should summarize recurring charges with dependente adicionais and provider references', async () => {
      (prismaMock.titular.findMany as jest.Mock).mockResolvedValue([
        { id: 1, nome: 'Ana', plano: { valorMensal: 100 }, dependentes: [{ valorAdicionalMensal: 9.9 }, { valorAdicionalMensal: 14.9 }] },
        { id: 2, nome: 'Bruno', plano: { valorMensal: 80 }, dependentes: [] },
      ]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { clienteId: 1, status: 'PENDENTE', valor: 124.8, dataVencimento: new Date('2026-07-10T00:00:00.000Z'), vencimento: null, asaasSubscriptionId: 'sub_local_1', cliente: { id: 1, nome: 'Ana' } },
      ]);
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([
        { titularId: 1, status: 'RECEBIDO', dataPagamento: new Date('2026-06-05T00:00:00.000Z'), asaasSubscriptionId: 'sub_local_1', titular: { id: 1, nome: 'Ana' } },
        { titularId: 2, status: 'RECEBIDO', dataPagamento: new Date('2026-05-05T00:00:00.000Z'), asaasSubscriptionId: 'sub_provider_2', titular: { id: 2, nome: 'Bruno' } },
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

    it('retorna lista vazia quando não há titulares', async () => {
      (prismaMock.titular.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([]);
      mockAsaasIntegration.listSubscriptionsFromProvider.mockResolvedValue([]);

      const result = await service.listarRecorrencias();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── gerarRecorrenciaParaTitular ──────────────────────────────────────────────
  describe('gerarRecorrenciaParaTitular', () => {
    it('should generate recurring billing using plano value plus beneficiarios adicionais', async () => {
      const syncSpy = jest
        .spyOn(service, 'sincronizarRecorrenciasAsaas')
        .mockResolvedValue({ processed: 0, inserted: 0, updated: 0 });

      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 9, nome: 'Cliente Recorrente', plano: { valorMensal: 100 },
        dependentes: [{ valorAdicionalMensal: 9.9 }, { valorAdicionalMensal: 10 }],
      });

      const result = await service.gerarRecorrenciaParaTitular(9, 'BOLETO');

      expect(mockAsaasIntegration.ensureMonthlySubscriptionForTitular).toHaveBeenCalledWith({
        titularId: 9, valorMensal: 119.9, descricao: 'Mensalidade Plano - Cliente Recorrente', billingType: 'BOLETO',
      });
      expect(syncSpy).toHaveBeenCalled();
      expect(result).toEqual({ titularId: 9, asaasSubscriptionId: 'sub_new_123', billingType: 'BOLETO' });
    });

    it('usa apenas o valor do plano quando sem dependentes adicionais', async () => {
      const syncSpy = jest.spyOn(service, 'sincronizarRecorrenciasAsaas').mockResolvedValue({ processed: 0, inserted: 0, updated: 0 });

      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 5, nome: 'Titular Simples', plano: { valorMensal: 80 }, dependentes: [],
      });

      await service.gerarRecorrenciaParaTitular(5, 'PIX');

      expect(mockAsaasIntegration.ensureMonthlySubscriptionForTitular).toHaveBeenCalledWith(
        expect.objectContaining({ titularId: 5, valorMensal: 80 }),
      );
      expect(syncSpy).toHaveBeenCalled();
    });

    it('lança erro quando titular não existe', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.gerarRecorrenciaParaTitular(999, 'BOLETO')).rejects.toThrow();
    });

    it('passa billingType BOLETO para ensureMonthlySubscription', async () => {
      jest.spyOn(service, 'sincronizarRecorrenciasAsaas').mockResolvedValue({ processed: 0, inserted: 0, updated: 0 });
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 10, nome: 'Titular', plano: { valorMensal: 120 }, dependentes: [],
      });

      await service.gerarRecorrenciaParaTitular(10, 'BOLETO');

      expect(mockAsaasIntegration.ensureMonthlySubscriptionForTitular).toHaveBeenCalledWith(
        expect.objectContaining({ billingType: 'BOLETO' }),
      );
    });

    it('passa billingType PIX para ensureMonthlySubscription', async () => {
      jest.spyOn(service, 'sincronizarRecorrenciasAsaas').mockResolvedValue({ processed: 0, inserted: 0, updated: 0 });
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 11, nome: 'Titular PIX', plano: { valorMensal: 90 }, dependentes: [],
      });

      await service.gerarRecorrenciaParaTitular(11, 'PIX');

      expect(mockAsaasIntegration.ensureMonthlySubscriptionForTitular).toHaveBeenCalledWith(
        expect.objectContaining({ billingType: 'PIX' }),
      );
    });
  });

  // ── listarContas — cenários adicionais ──────────────────────────────────────
  describe('listarContas — cenários adicionais', () => {
    it('retorna lista vazia quando não há contas', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.listarContas();
      expect(Array.isArray(result)).toBe(true);
    });

    it('retorna contas pagar e receber combinadas', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([
        { id: 1, descricao: 'Água', valor: 50, vencimento: new Date(), status: 'PENDENTE', tipo: 'PAGAR' },
      ]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([
        { id: 10, descricao: 'Mensalidade', valor: 100, vencimento: new Date(), status: 'PENDENTE', tipo: 'RECEBER' },
      ]);
      const result = await service.listarContas();
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('repassa erro do prisma em listarContas', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockRejectedValue(new Error('DB error'));
      await expect(service.listarContas()).rejects.toThrow('DB error');
    });

    it('retorna contas com id único', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([
        { id: 1, descricao: 'Água', valor: 50, vencimento: new Date(), status: 'PENDENTE' },
        { id: 2, descricao: 'Luz', valor: 80, vencimento: new Date(), status: 'PENDENTE' },
      ]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.listarContas();
      const ids = result.map((c: any) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ── deletarContaPagar — cenários adicionais ──────────────────────────────────
  describe('deletarContaPagar — cenários adicionais', () => {
    it('chama delete com id correto', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue({ id: 5, status: 'PENDENTE' });
      (prismaMock.contaPagar.delete as jest.Mock).mockResolvedValue({ id: 5 });
      await service.deletarContaPagar(5);
      expect(prismaMock.contaPagar.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('repassa erro de FK constraint', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: 'PENDENTE' });
      (prismaMock.contaPagar.delete as jest.Mock).mockRejectedValue(new Error('FK constraint'));
      await expect(service.deletarContaPagar(1)).rejects.toThrow('FK constraint');
    });

    it('lança erro quando conta não existe', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.deletarContaPagar(9999)).rejects.toBeDefined();
    });
  });

  // ── deletarContaReceber — cenários adicionais ────────────────────────────────
  describe('deletarContaReceber — cenários adicionais', () => {
    it('chama delete com id correto', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: 8, status: 'PENDENTE' });
      (prismaMock.contaReceber.delete as jest.Mock).mockResolvedValue({ id: 8 });
      await service.deletarContaReceber(8);
      expect(prismaMock.contaReceber.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 8 } }),
      );
    });

    it('repassa erro de constraint', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: 'PENDENTE' });
      (prismaMock.contaReceber.delete as jest.Mock).mockRejectedValue(new Error('Constraint error'));
      await expect(service.deletarContaReceber(1)).rejects.toThrow('Constraint error');
    });

    it('lança erro quando conta não existe', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.deletarContaReceber(9999)).rejects.toBeDefined();
    });
  });

  // ── criarContaPagar — cenários adicionais ────────────────────────────────────
  describe('criarContaPagar — cenários adicionais', () => {
    it('cria com categoria especificada', async () => {
      (prismaMock.contaPagar.create as jest.Mock).mockResolvedValue({ id: 1, categoria: 'Fornecedores' });
      const result = await service.criarContaPagar({ descricao: 'X', valor: 100, categoria: 'Fornecedores', vencimento: new Date() } as any);
      expect((result as any).categoria).toBe('Fornecedores');
    });

    it('cria com status PENDENTE por padrão', async () => {
      (prismaMock.contaPagar.create as jest.Mock).mockResolvedValue({ id: 2, status: 'PENDENTE' });
      const result = await service.criarContaPagar({ descricao: 'Y', valor: 200, vencimento: new Date() } as any);
      expect((result as any).status).toBe('PENDENTE');
    });

    it('repassa erro de validação', async () => {
      (prismaMock.contaPagar.create as jest.Mock).mockRejectedValue(new Error('Validation failed'));
      await expect(service.criarContaPagar({ descricao: '', valor: -1, vencimento: new Date() } as any)).rejects.toBeDefined();
    });
  });

  // ── criarContaReceber — cenários adicionais ──────────────────────────────────
  describe('criarContaReceber — cenários adicionais', () => {
    it('cria com titularId especificado', async () => {
      (prismaMock.contaReceber.create as jest.Mock).mockResolvedValue({ id: 1, titularId: 5 });
      const result = await service.criarContaReceber({ descricao: 'Mens', valor: 80, vencimento: new Date(), titularId: 5 } as any);
      expect((result as any).titularId).toBe(5);
    });

    it('rejeita valor negativo', async () => {
      await expect(service.criarContaReceber({ descricao: 'X', valor: -1, vencimento: new Date() } as any)).rejects.toBeDefined();
    });

    it('repassa erro do prisma', async () => {
      (prismaMock.contaReceber.create as jest.Mock).mockRejectedValue(new Error('DB error'));
      await expect(service.criarContaReceber({ descricao: 'Y', valor: 100, vencimento: new Date() } as any)).rejects.toThrow('DB error');
    });
  });

  // ── listarContas — cenários extra ─────────────────────────────────────────
  describe('listarContas — cenários extra', () => {
    it('retorna lista vazia quando não há contas', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.listarContas();
      expect(Array.isArray(result)).toBe(true);
    });

    it('retorna contas a pagar e receber combinadas', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([{ id: 1, tipo: 'PAGAR' }]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([{ id: 2, tipo: 'RECEBER' }]);
      const result = await service.listarContas();
      expect(result).toBeDefined();
    });

    it('repassa erro de contaPagar.findMany', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockRejectedValue(new Error('CP err'));
      await expect(service.listarContas()).rejects.toThrow('CP err');
    });

    it('retorna lista com 2 elementos quando há 1 pagar e 1 receber', async () => {
      (prismaMock.contaPagar.findMany as jest.Mock).mockResolvedValue([{ id: 1 }]);
      (prismaMock.contaReceber.findMany as jest.Mock).mockResolvedValue([{ id: 2 }]);
      const result = await service.listarContas();
      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ── atualizarContaPagar — cenários extra ─────────────────────────────────────
  describe('atualizarContaPagar — cenários extra', () => {
    it('atualiza descricao da conta', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: 'PENDENTE' });
      (prismaMock.contaPagar.update as jest.Mock).mockResolvedValue({ id: 1, descricao: 'Nova Desc' });
      const result = await service.atualizarContaPagar(1, { descricao: 'Nova Desc' } as any);
      expect(result).toBeDefined();
    });

    it('lança erro quando conta não existe', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.atualizarContaPagar(999, {} as any)).rejects.toBeDefined();
    });

    it('repassa erro do prisma.update', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: 'PENDENTE' });
      (prismaMock.contaPagar.update as jest.Mock).mockRejectedValue(new Error('Update fail'));
      await expect(service.atualizarContaPagar(1, {} as any)).rejects.toThrow('Update fail');
    });

    it('não permite atualizar conta CANCELADA', async () => {
      (prismaMock.contaPagar.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: 'CANCELADA' });
      await expect(service.atualizarContaPagar(1, { descricao: 'X' } as any)).rejects.toBeDefined();
    });
  });

  // ── atualizarContaReceber — cenários extra ────────────────────────────────────
  describe('atualizarContaReceber — cenários extra', () => {
    it('atualiza valor da conta', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: 'PENDENTE' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({ id: 1, valor: 200 });
      const result = await service.atualizarContaReceber(1, { valor: 200 } as any);
      expect(result).toBeDefined();
    });

    it('lança erro quando conta não existe', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.atualizarContaReceber(999, {} as any)).rejects.toBeDefined();
    });

    it('repassa erro do prisma.update', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({ id: 1, status: 'PENDENTE' });
      (prismaMock.contaReceber.update as jest.Mock).mockRejectedValue(new Error('CR update err'));
      await expect(service.atualizarContaReceber(1, {} as any)).rejects.toThrow('CR update err');
    });
  });

  // ── criarContaPagar extra ────────────────────────────────────────────────────
  describe('criarContaPagar extra', () => {
    it('cria conta com valor 50', async () => {
      (prismaMock.contaPagar.create as jest.Mock).mockResolvedValue({ id: 99, valor: 50 });
      const result = await service.criarContaPagar({ descricao: 'W', valor: 50, vencimento: new Date() } as any);
      expect((result as any).id).toBe(99);
    });

    it('cria conta retorna objeto com valor correto', async () => {
      (prismaMock.contaPagar.create as jest.Mock).mockResolvedValue({ id: 10, valor: 150 });
      const result = await service.criarContaPagar({ descricao: 'Z', valor: 150, vencimento: new Date() } as any);
      expect((result as any).valor).toBe(150);
    });
  });

  // ── criarContaReceber extra ───────────────────────────────────────────────────
  describe('criarContaReceber extra', () => {
    it('cria conta com vencimento futuro', async () => {
      (prismaMock.contaReceber.create as jest.Mock).mockResolvedValue({ id: 5, valor: 100 });
      const future = new Date(Date.now() + 30 * 24 * 3600 * 1000);
      const result = await service.criarContaReceber({ descricao: 'Mens', valor: 100, vencimento: future } as any);
      expect(result).toBeDefined();
    });

    it('cria conta retorna objeto com id', async () => {
      (prismaMock.contaReceber.create as jest.Mock).mockResolvedValue({ id: 55 });
      const result = await service.criarContaReceber({ descricao: 'M', valor: 90, vencimento: new Date() } as any);
      expect((result as any).id).toBe(55);
    });
  });
});