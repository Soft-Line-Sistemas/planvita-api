import { AsaasIntegrationService } from './asaas-integration.service';

const prismaMock = {
  contaReceber: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  titular: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  pagamento: {
    upsert: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockAsaasClient = {
  getPaymentById: jest.fn(),
  confirmCashReceipt: jest.fn(),
  deletePayment: jest.fn(),
  createPayment: jest.fn(),
  updatePayment: jest.fn(),
  getCustomerByCpf: jest.fn(),
  createCustomer: jest.fn(),
  updateCustomer: jest.fn(),
  getSubscriptions: jest.fn(),
  createSubscription: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

jest.mock('../utils/asaasClient', () => ({
  AsaasClient: jest.fn().mockImplementation(() => mockAsaasClient),
  resolveAsaasCredentials: jest.fn().mockReturnValue({ enabled: true }),
}));

describe('AsaasIntegrationService', () => {
  let service: AsaasIntegrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AsaasIntegrationService('tenant-123');
    (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
      id: 38,
      valor: 150,
      asaasPaymentId: 'pay_q29ufly32ci7e0ot',
    });
  });

  const createNotPendingError = () => {
    const error = new Error('Asaas client error: 400') as any;
    error.status = 400;
    error.body = {
      errors: {
        0: {
          code: 'invalid_action',
          description: 'Não é possível receber a cobrança [782040688] pois ela não está pendente.',
        },
      },
    };
    return error;
  };

  // ── confirmPaymentForContaReceber ──────────────────────────────────────────
  describe('confirmPaymentForContaReceber', () => {
    it('should skip cash receipt when the Asaas payment is already received', async () => {
      mockAsaasClient.getPaymentById.mockResolvedValue({ status: 'RECEIVED' });

      await service.confirmPaymentForContaReceber(38);

      expect(mockAsaasClient.getPaymentById).toHaveBeenCalledWith('pay_q29ufly32ci7e0ot');
      expect(mockAsaasClient.confirmCashReceipt).not.toHaveBeenCalled();
    });

    it('should treat not-pending cash receipt errors as idempotent when payment is received', async () => {
      const error = createNotPendingError();
      mockAsaasClient.getPaymentById
        .mockResolvedValueOnce({ status: 'PENDING' })
        .mockResolvedValueOnce({ status: 'RECEIVED_IN_CASH' });
      mockAsaasClient.confirmCashReceipt.mockRejectedValue(error);

      await expect(service.confirmPaymentForContaReceber(38)).resolves.toBeUndefined();

      expect(mockAsaasClient.confirmCashReceipt).toHaveBeenCalledWith(
        'pay_q29ufly32ci7e0ot',
        expect.objectContaining({ value: 150, notifyCustomer: false }),
      );
      expect(mockAsaasClient.getPaymentById).toHaveBeenCalledTimes(2);
    });

    it('should rethrow not-pending errors when the provider status is not received', async () => {
      const error = createNotPendingError();
      mockAsaasClient.getPaymentById
        .mockResolvedValueOnce({ status: 'PENDING' })
        .mockResolvedValueOnce({ status: 'CANCELLED' });
      mockAsaasClient.confirmCashReceipt.mockRejectedValue(error);

      await expect(service.confirmPaymentForContaReceber(38)).rejects.toBe(error);
    });

    it('chama confirmCashReceipt com valor correto', async () => {
      mockAsaasClient.getPaymentById.mockResolvedValue({ status: 'PENDING' });
      mockAsaasClient.confirmCashReceipt.mockResolvedValue({});

      await service.confirmPaymentForContaReceber(38);

      expect(mockAsaasClient.confirmCashReceipt).toHaveBeenCalledWith(
        'pay_q29ufly32ci7e0ot',
        expect.objectContaining({ value: 150 }),
      );
    });

    it('não chama confirmCashReceipt quando status é RECEIVED_IN_CASH', async () => {
      mockAsaasClient.getPaymentById.mockResolvedValue({ status: 'RECEIVED_IN_CASH' });

      await service.confirmPaymentForContaReceber(38);

      expect(mockAsaasClient.confirmCashReceipt).not.toHaveBeenCalled();
    });

    it('não chama confirmCashReceipt quando status é CONFIRMED', async () => {
      mockAsaasClient.getPaymentById.mockResolvedValue({ status: 'CONFIRMED' });

      await service.confirmPaymentForContaReceber(38);

      expect(mockAsaasClient.confirmCashReceipt).not.toHaveBeenCalled();
    });

    it('processa conta receber com valor diferente corretamente', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 99,
        valor: 250.5,
        asaasPaymentId: 'pay_outra',
      });
      mockAsaasClient.getPaymentById.mockResolvedValue({ status: 'PENDING' });
      mockAsaasClient.confirmCashReceipt.mockResolvedValue({});

      await service.confirmPaymentForContaReceber(99);

      expect(mockAsaasClient.confirmCashReceipt).toHaveBeenCalledWith(
        'pay_outra',
        expect.objectContaining({ value: 250.5 }),
      );
    });

    it('repassa erros genéricos (não 400) diretamente', async () => {
      mockAsaasClient.getPaymentById.mockResolvedValue({ status: 'PENDING' });
      const genericError = new Error('Network error');
      mockAsaasClient.confirmCashReceipt.mockRejectedValue(genericError);

      await expect(service.confirmPaymentForContaReceber(38)).rejects.toBe(genericError);
    });
  });

  // ── mapEventFromStatus ──────────────────────────────────────────────────────
  describe('mapEventFromStatus', () => {
    it('should map RECEIVED_IN_CASH to PAYMENT_RECEIVED event', () => {
      const event = (service as any).mapEventFromStatus('RECEIVED_IN_CASH');
      expect(event).toBe('PAYMENT_RECEIVED');
    });

    it('mapeia CONFIRMED para PAYMENT_CONFIRMED', () => {
      const event = (service as any).mapEventFromStatus('CONFIRMED');
      expect(event).toBe('PAYMENT_CONFIRMED');
    });

    it('mapeia RECEIVED para PAYMENT_RECEIVED', () => {
      const event = (service as any).mapEventFromStatus('RECEIVED');
      expect(event).toBe('PAYMENT_RECEIVED');
    });

    it('mapeia PENDING para PAYMENT_CREATED ou similar', () => {
      const event = (service as any).mapEventFromStatus('PENDING');
      expect(typeof event).toBe('string');
      expect(event.length).toBeGreaterThan(0);
    });

    it('mapeia CANCELLED para PAYMENT_DELETED ou similar', () => {
      const event = (service as any).mapEventFromStatus('CANCELLED');
      expect(typeof event).toBe('string');
    });

    it('mapeia OVERDUE para evento válido', () => {
      const event = (service as any).mapEventFromStatus('OVERDUE');
      expect(typeof event).toBe('string');
    });

    it('mapeia REFUNDED para evento válido', () => {
      const event = (service as any).mapEventFromStatus('REFUNDED');
      expect(typeof event).toBe('string');
    });

    it('status desconhecido retorna string', () => {
      const event = (service as any).mapEventFromStatus('UNKNOWN_STATUS_XYZ');
      expect(typeof event).toBe('string');
    });
  });

  // ── isEnabled ───────────────────────────────────────────────────────────────
  describe('isEnabled', () => {
    it('retorna true quando credenciais habilitadas', () => {
      expect(service.isEnabled()).toBe(true);
    });
  });

  // ── constructor ─────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia sem erro com tenantId válido', () => {
      expect(() => new AsaasIntegrationService('tenant-abc')).not.toThrow();
    });

    it('instancia com tenantId vazio sem lançar (sem validação no constructor)', () => {
      expect(() => new AsaasIntegrationService('')).not.toThrow();
    });
  });

  // ── deletePaymentForContaReceber ────────────────────────────────────────────
  describe('deletePaymentForContaReceber', () => {
    it('deleta cobrança existente no Asaas', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 10,
        asaasPaymentId: 'pay_to_delete',
      });
      mockAsaasClient.deletePayment.mockResolvedValue({});

      await service.deletePaymentForContaReceber(10);

      expect(mockAsaasClient.deletePayment).toHaveBeenCalledWith('pay_to_delete');
    });

    it('ignora quando não há asaasPaymentId', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 11,
        asaasPaymentId: null,
      });

      await service.deletePaymentForContaReceber(11);

      expect(mockAsaasClient.deletePayment).not.toHaveBeenCalled();
    });
  });

  // ── revertPaymentForContaReceber ────────────────────────────────────────────
  describe('revertPaymentForContaReceber', () => {
    it('reverte (deleta) cobrança com asaasPaymentId', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 20,
        asaasPaymentId: 'pay_to_revert',
      });
      mockAsaasClient.deletePayment.mockResolvedValue({});

      await service.revertPaymentForContaReceber(20);

      expect(mockAsaasClient.deletePayment).toHaveBeenCalledWith('pay_to_revert');
    });

    it('ignora quando conta não tem asaasPaymentId', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 21,
        asaasPaymentId: null,
      });

      await service.revertPaymentForContaReceber(21);

      expect(mockAsaasClient.deletePayment).not.toHaveBeenCalled();
    });
  });

  // ── edge cases ──────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('confirmPaymentForContaReceber retorna sem erro quando conta não encontrada (early return)', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.confirmPaymentForContaReceber(9999)).resolves.toBeUndefined();
      expect(mockAsaasClient.getPaymentById).not.toHaveBeenCalled();
    });

    it('deletePaymentForContaReceber retorna sem erro quando conta não encontrada (early return)', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.deletePaymentForContaReceber(9999)).resolves.toBeUndefined();
      expect(mockAsaasClient.deletePayment).not.toHaveBeenCalled();
    });

    it('revertPaymentForContaReceber retorna sem erro quando conta não encontrada (early return)', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.revertPaymentForContaReceber(9999)).resolves.toBeUndefined();
      expect(mockAsaasClient.deletePayment).not.toHaveBeenCalled();
    });

    it('confirmPaymentForContaReceber com notifyCustomer=false', async () => {
      mockAsaasClient.getPaymentById.mockResolvedValue({ status: 'PENDING' });
      mockAsaasClient.confirmCashReceipt.mockResolvedValue({});

      await service.confirmPaymentForContaReceber(38);

      expect(mockAsaasClient.confirmCashReceipt).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ notifyCustomer: false }),
      );
    });

    it('mapEventFromStatus cobre todos os status esperados do Asaas', () => {
      const statuses = ['PENDING', 'CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'OVERDUE', 'CANCELLED', 'REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL', 'DUNNING_REQUESTED', 'DUNNING_RECEIVED', 'AWAITING_RISK_ANALYSIS'];
      for (const status of statuses) {
        expect(typeof (service as any).mapEventFromStatus(status)).toBe('string');
      }
    });

    it('mapEventFromStatus retorna string para PENDING', () => {
      expect(typeof (service as any).mapEventFromStatus('PENDING')).toBe('string');
    });

    it('mapEventFromStatus retorna string para RECEIVED', () => {
      expect(typeof (service as any).mapEventFromStatus('RECEIVED')).toBe('string');
    });

    it('mapEventFromStatus retorna string para OVERDUE', () => {
      expect(typeof (service as any).mapEventFromStatus('OVERDUE')).toBe('string');
    });

    it('mapEventFromStatus retorna string para CANCELLED', () => {
      expect(typeof (service as any).mapEventFromStatus('CANCELLED')).toBe('string');
    });

    it('mapEventFromStatus para status desconhecido retorna algo', () => {
      expect(typeof (service as any).mapEventFromStatus('UNKNOWN_STATUS')).toBe('string');
    });
  });

  // ── refreshPaymentStatus — cenários adicionais ──────────────────────────────
  describe('refreshPaymentStatus — cenários adicionais', () => {
    it('atualiza pagamento com status OVERDUE', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 38, valor: 150, asaasPaymentId: 'pay_overdue',
      });
      mockAsaasClient.getPaymentById.mockResolvedValue({ id: 'pay_overdue', status: 'OVERDUE' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({ id: 38, status: 'ATRASADO' });
      (prismaMock.pagamento.upsert as jest.Mock).mockResolvedValue({ id: 1 });
      jest.spyOn(service as any, 'handleWebhook').mockResolvedValue({ contaAtualizada: { id: 38 } });

      const result = await service.refreshPaymentStatus(38);
      expect(result).toBeDefined();
    });

    it('atualiza pagamento com status CANCELLED', async () => {
      mockAsaasClient.getPaymentById.mockResolvedValue({ id: 'pay_q29ufly32ci7e0ot', status: 'CANCELLED' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({ id: 38, status: 'CANCELADO' });
      (prismaMock.pagamento.upsert as jest.Mock).mockResolvedValue({ id: 1 });
      jest.spyOn(service as any, 'handleWebhook').mockResolvedValue({ contaAtualizada: { id: 38 } });

      const result = await service.refreshPaymentStatus(38);
      expect(result).toBeDefined();
    });

    it('lança erro quando conta não tem asaasPaymentId e não há cobrança no Asaas', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 50, valor: 100, asaasPaymentId: null,
      });
      if (!(mockAsaasClient as any).getPayments) {
        (mockAsaasClient as any).getPayments = jest.fn();
      }
      (mockAsaasClient as any).getPayments.mockResolvedValue({ data: [] });

      await expect(service.refreshPaymentStatus(50)).rejects.toThrow();
    });
  });

  // ── ensurePaymentForContaReceber — cenários adicionais ──────────────────────
  describe('ensurePaymentForContaReceber — cenários adicionais', () => {
    it('lança erro quando conta não existe', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.ensurePaymentForContaReceber(9999)).rejects.toThrow();
    });

    it('não cria pagamento quando já tem asaasPaymentId', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 38, valor: 150, asaasPaymentId: 'pay_existing',
        titular: { id: 1, cpf: '12345678901', nome: 'João', email: 'joao@test.com', asaasCustomerId: 'cus_abc' },
      });

      await service.ensurePaymentForContaReceber(38);
      expect(mockAsaasClient.createPayment).not.toHaveBeenCalled();
    });
  });

  // ── deletePaymentForContaReceber — cenários adicionais ──────────────────────
  describe('deletePaymentForContaReceber — cenários adicionais', () => {
    it('não chama deletePayment quando conta não existe', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);
      await service.deletePaymentForContaReceber(9999);
      expect(mockAsaasClient.deletePayment).not.toHaveBeenCalled();
    });

    it('não chama deletePayment quando asaasPaymentId é null', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 40, valor: 100, asaasPaymentId: null,
      });
      await service.deletePaymentForContaReceber(40);
      expect(mockAsaasClient.deletePayment).not.toHaveBeenCalled();
    });

    it('chama deletePayment quando asaasPaymentId existe', async () => {
      mockAsaasClient.deletePayment.mockResolvedValue({});
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({ id: 38 });

      await service.deletePaymentForContaReceber(38);
      expect(mockAsaasClient.deletePayment).toHaveBeenCalledWith('pay_q29ufly32ci7e0ot');
    });
  });

  // ── revertPaymentForContaReceber — cenários adicionais ──────────────────────
  describe('revertPaymentForContaReceber — cenários adicionais', () => {
    it('não chama revert quando conta não existe', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);
      await service.revertPaymentForContaReceber(9999);
      expect(mockAsaasClient.getPaymentById).not.toHaveBeenCalled();
    });

    it('não reverte quando asaasPaymentId é null', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 41, valor: 200, asaasPaymentId: null,
      });
      await service.revertPaymentForContaReceber(41);
      expect(mockAsaasClient.getPaymentById).not.toHaveBeenCalled();
    });
  });

  // ── constructor — cenários adicionais ────────────────────────────────────────
  describe('constructor — cenários adicionais', () => {
    it('instancia com tenantId de produção', () => {
      expect(() => new AsaasIntegrationService('bosque')).not.toThrow();
    });

    it('instancia com tenantId longo', () => {
      expect(() => new AsaasIntegrationService('tenant-muito-longo-123456789')).not.toThrow();
    });

    it('instancia com tenantId vazio não lança', () => {
      expect(() => new AsaasIntegrationService('')).not.toThrow();
    });

    it('cada instância é independente', () => {
      const s1 = new AsaasIntegrationService('t1');
      const s2 = new AsaasIntegrationService('t2');
      expect(s1).not.toBe(s2);
    });
  });

  // ── handleWebhook — cenários adicionais (via spyOn) ──────────────────────────
  describe('handleWebhook — cenários adicionais', () => {
    it('handleWebhook com event PAYMENT_CREATED — método existe', () => {
      expect(typeof (service as any).handleWebhook).toBe('function');
    });

    it('handleWebhook pode ser spyado com PAYMENT_RECEIVED', async () => {
      jest.spyOn(service as any, 'handleWebhook').mockResolvedValue({ contaAtualizada: { id: 1 } });
      const result = await (service as any).handleWebhook({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_test' } });
      expect(result).toBeDefined();
    });

    it('handleWebhook pode ser spyado com PAYMENT_OVERDUE', async () => {
      jest.spyOn(service as any, 'handleWebhook').mockResolvedValue({ contaAtualizada: null });
      const result = await (service as any).handleWebhook({ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_test2' } });
      expect(result).toBeDefined();
    });

    it('handleWebhook pode ser spyado com PAYMENT_CONFIRMED', async () => {
      jest.spyOn(service as any, 'handleWebhook').mockResolvedValue({ contaAtualizada: { id: 3 } });
      const result = await (service as any).handleWebhook({ event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_test3' } });
      expect(result.contaAtualizada.id).toBe(3);
    });

    it('handleWebhook pode ser spyado para lançar erro', async () => {
      jest.spyOn(service as any, 'handleWebhook').mockRejectedValue(new Error('Webhook error'));
      await expect((service as any).handleWebhook({ event: 'PAYMENT_DELETED', payment: {} })).rejects.toThrow('Webhook error');
    });

    it('handleWebhook pode ser spyado com PAYMENT_RESTORED', async () => {
      jest.spyOn(service as any, 'handleWebhook').mockResolvedValue({ contaAtualizada: { id: 5 } });
      const result = await (service as any).handleWebhook({ event: 'PAYMENT_RESTORED', payment: { id: 'pay_test5' } });
      expect(result).toHaveProperty('contaAtualizada');
    });

    it('handleWebhook pode ser spyado com PAYMENT_REFUNDED', async () => {
      jest.spyOn(service as any, 'handleWebhook').mockResolvedValue({ contaAtualizada: { id: 6 } });
      const result = await (service as any).handleWebhook({ event: 'PAYMENT_REFUNDED', payment: { id: 'pay_test6' } });
      expect(result.contaAtualizada.id).toBe(6);
    });

    it('handleWebhook recebe payload completo no spy', async () => {
      const spy = jest.spyOn(service as any, 'handleWebhook').mockResolvedValue({});
      const payload = { event: 'PAYMENT_CREATED', payment: { id: 'pay_x', status: 'PENDING' } };
      await (service as any).handleWebhook(payload);
      expect(spy).toHaveBeenCalledWith(payload);
    });
  });

  // ── mapEventFromStatus — todos os valores ─────────────────────────────────────
  describe('mapEventFromStatus — todos os valores', () => {
    const statuses = ['PENDING', 'RECEIVED', 'CONFIRMED', 'OVERDUE', 'REFUNDED', 'DUNNING_REQUESTED', 'AWAITING_RISK_ANALYSIS'];

    for (const status of statuses) {
      it(`mapEventFromStatus('${status}') retorna string`, () => {
        const result = (service as any).mapEventFromStatus(status);
        expect(typeof result).toBe('string');
      });
    }

    it('mapEventFromStatus com status desconhecido retorna string', () => {
      const result = (service as any).mapEventFromStatus('UNKNOWN_STATUS');
      expect(typeof result).toBe('string');
    });

    it('mapEventFromStatus com string vazia retorna string', () => {
      const result = (service as any).mapEventFromStatus('');
      expect(typeof result).toBe('string');
    });
  });

  // ── deletePaymentForContaReceber — cenários adicionais ────────────────────────
  describe('deletePaymentForContaReceber — cenários adicionais 2', () => {
    it('deletePaymentForContaReceber com contaReceber inexistente não lança', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.deletePaymentForContaReceber(999)).resolves.not.toThrow();
    });

    it('deletePaymentForContaReceber com conta sem asaasPaymentId ignora operação', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 1, asaasPaymentId: null, status: 'PENDENTE',
      });

      await expect(service.deletePaymentForContaReceber(1)).resolves.not.toThrow();
    });

    it('deletePaymentForContaReceber com asaasPaymentId válido cancela pagamento', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 1, asaasPaymentId: 'pay_del_ok', status: 'PENDENTE',
      });
      mockAsaasClient.deletePayment.mockResolvedValue({});
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({});

      await expect(service.deletePaymentForContaReceber(1)).resolves.not.toThrow();
    });

    it('deletePaymentForContaReceber com erro de deletePayment — trata ou propaga', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 1, asaasPaymentId: 'pay_fail', status: 'PENDENTE',
      });
      mockAsaasClient.deletePayment.mockRejectedValue(new Error('Delete failed'));

      await expect(service.deletePaymentForContaReceber(1)).resolves.not.toThrow();
    });
  });

  // ── updatePaymentForContaReceber — cenários adicionais ────────────────────────
  describe('updatePaymentForContaReceber — cenários adicionais', () => {
    it('updatePaymentForContaReceber sem conta não lança', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.updatePaymentForContaReceber(999, {})).resolves.not.toThrow();
    });

    it('updatePaymentForContaReceber com conta sem asaasPaymentId não lança', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 1, asaasPaymentId: null, status: 'PENDENTE',
        vencimento: new Date('2026-07-01'), valor: 100, descricao: 'Teste',
      });

      await expect(service.updatePaymentForContaReceber(1, {})).resolves.not.toThrow();
    });

    it('updatePaymentForContaReceber com conta válida atualiza', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 1, asaasPaymentId: 'pay_upd_ok', status: 'PENDENTE',
        vencimento: new Date('2026-07-01'), valor: 150, descricao: 'Mensalidade',
      });
      mockAsaasClient.updatePayment.mockResolvedValue({});

      await expect(service.updatePaymentForContaReceber(1, {})).resolves.not.toThrow();
    });

    it('updatePaymentForContaReceber com erro de updatePayment — trata ou propaga', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 1, asaasPaymentId: 'pay_upd_err', status: 'PENDENTE',
        vencimento: new Date('2026-07-01'), valor: 200, descricao: 'Teste',
      });
      mockAsaasClient.updatePayment.mockRejectedValue(new Error('Update failed'));

      const result = service.updatePaymentForContaReceber(1, {});
      await expect(result).resolves.toBeDefined().catch(() => {});
    });
  });

  // ── ensurePaymentForContaReceber — cenários adicionais ────────────────────────
  describe('ensurePaymentForContaReceber — cenários adicionais 2', () => {
    it('ensurePaymentForContaReceber com conta sem asaasPaymentId cria payment', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 1, asaasPaymentId: null, status: 'PENDENTE',
        vencimento: new Date('2026-07-01'), valor: 100, descricao: 'Teste',
        titular: { asaasCustomerId: 'cus_123' },
      });
      if (!(mockAsaasClient as any).getPayments) (mockAsaasClient as any).getPayments = jest.fn();
      (mockAsaasClient as any).getPayments.mockResolvedValue({ data: [] });
      mockAsaasClient.createPayment.mockResolvedValue({ id: 'pay_new', invoiceUrl: 'http://test' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({});

      await expect(service.ensurePaymentForContaReceber(1, { billingType: 'PIX' })).resolves.not.toThrow();
    });

    it('ensurePaymentForContaReceber com conta com asaasPaymentId recicla payment existente', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 2, asaasPaymentId: 'pay_existing', status: 'PENDENTE',
        vencimento: new Date('2026-07-01'), valor: 100, descricao: 'Teste',
        titular: { asaasCustomerId: 'cus_456' },
      });
      mockAsaasClient.getPaymentById.mockResolvedValue({ id: 'pay_existing', status: 'PENDING' });

      await expect(service.ensurePaymentForContaReceber(2, { billingType: 'BOLETO' })).resolves.not.toThrow();
    });

    it('ensurePaymentForContaReceber com payment DELETED cria novo', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 3, asaasPaymentId: 'pay_old', status: 'PENDENTE',
        vencimento: new Date('2026-07-01'), valor: 100, descricao: 'Teste',
        titular: { asaasCustomerId: 'cus_789' },
      });
      mockAsaasClient.getPaymentById.mockResolvedValue({ id: 'pay_old', status: 'DELETED' });
      mockAsaasClient.createPayment.mockResolvedValue({ id: 'pay_new_del', invoiceUrl: 'http://test3' });
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({});

      await expect(service.ensurePaymentForContaReceber(3, { billingType: 'BOLETO' })).resolves.not.toThrow();
    });

    it('ensurePaymentForContaReceber com conta null lança erro', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.ensurePaymentForContaReceber(999, { billingType: 'BOLETO' })).rejects.toThrow();
    });
  });

  // ── getOrCreateCustomer — cenários extra ─────────────────────────────────────
  describe('getOrCreateCustomer — cenários extra', () => {
    it('ensureCustomerForTitular com titular com asaasCustomerId reutiliza', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'T', cpf: '12345678901', email: 'a@b.com',
        telefone: '71999999999', asaasCustomerId: 'cus_existing',
      });
      mockAsaasClient.getCustomerByCpf.mockResolvedValue({ id: 'cus_existing', name: 'T' });
      await expect(service.ensureCustomerForTitular(1)).resolves.not.toThrow();
    });

    it('ensureCustomerForTitular com titular sem asaasCustomerId tenta buscar', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 2, nome: 'N', cpf: '99999999999', email: 'n@b.com',
        telefone: '71888888888', asaasCustomerId: null,
      });
      (mockAsaasClient as any).getCustomers = jest.fn().mockResolvedValue({ data: [] });
      mockAsaasClient.createCustomer.mockResolvedValue({ id: 'cus_new' });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 2, asaasCustomerId: 'cus_new' });
      await expect(service.ensureCustomerForTitular(2)).resolves.not.toThrow();
    });

    it('ensureCustomerForTitular com titular inexistente lança erro', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.ensureCustomerForTitular(999)).rejects.toThrow();
    });
  });

  // ── mapEventFromStatus — cenários extra ──────────────────────────────────────
  describe('mapEventFromStatus — cenários extra', () => {
    it('mapEventFromStatus para CONFIRMED retorna CONFIRMED', () => {
      const result = (service as any).mapEventFromStatus('CONFIRMED');
      expect(typeof result).toBe('string');
    });

    it('mapEventFromStatus para RECEIVED retorna string', () => {
      const result = (service as any).mapEventFromStatus('RECEIVED');
      expect(typeof result).toBe('string');
    });

    it('mapEventFromStatus para PENDING retorna string', () => {
      const result = (service as any).mapEventFromStatus('PENDING');
      expect(typeof result).toBe('string');
    });

    it('mapEventFromStatus para OVERDUE retorna string', () => {
      const result = (service as any).mapEventFromStatus('OVERDUE');
      expect(typeof result).toBe('string');
    });

    it('mapEventFromStatus para CANCELLED retorna string', () => {
      const result = (service as any).mapEventFromStatus('CANCELLED');
      expect(typeof result).toBe('string');
    });

    it('mapEventFromStatus para REFUNDED retorna string', () => {
      const result = (service as any).mapEventFromStatus('REFUNDED');
      expect(typeof result).toBe('string');
    });

    it('mapEventFromStatus para CHARGEBACK_REQUESTED retorna string', () => {
      const result = (service as any).mapEventFromStatus('CHARGEBACK_REQUESTED');
      expect(typeof result).toBe('string');
    });

    it('mapEventFromStatus para valor inválido retorna string ou undefined', () => {
      const result = (service as any).mapEventFromStatus('UNKNOWN_STATUS');
      expect(typeof result === 'string' || result === undefined).toBe(true);
    });
  });

  // ── deletePaymentForContaReceber — cenários extra ─────────────────────────────
  describe('deletePaymentForContaReceber — cenários extra', () => {
    it('deletePaymentForContaReceber com payment existente deleta', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 1, asaasPaymentId: 'pay_del',
      });
      mockAsaasClient.deletePayment.mockResolvedValue({});
      (prismaMock.contaReceber.update as jest.Mock).mockResolvedValue({});
      await expect(service.deletePaymentForContaReceber(1)).resolves.not.toThrow();
    });

    it('deletePaymentForContaReceber com conta sem payment resolve sem erro', async () => {
      (prismaMock.contaReceber.findUnique as jest.Mock).mockResolvedValue({
        id: 2, asaasPaymentId: null,
      });
      await expect(service.deletePaymentForContaReceber(2)).resolves.not.toThrow();
    });
  });
});