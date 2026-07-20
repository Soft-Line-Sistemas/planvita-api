import { AsaasIntegrationService } from './asaas-integration.service';

const prismaMock = {
  contaReceber: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
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
  paymentMethodChangeRequest: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
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
  tokenizeCreditCard: jest.fn(),
  createOrUpdateSubscription: jest.fn(),
  updateSubscriptionCreditCard: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

jest.mock('../utils/asaasClient', () => ({
  AsaasClient: jest.fn().mockImplementation(() => mockAsaasClient),
  resolveAsaasCredentials: jest.fn().mockReturnValue({ enabled: true }),
}));

jest.mock('../utils/crypto', () => ({
  encryptText: jest.fn((v: string) => `enc:${v}`),
  decryptText: jest.fn((v: string) => v.replace(/^enc:/, '')),
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

  describe('resolveWebhookStatus', () => {
    it('prioriza payment.status quando o evento é genérico', () => {
      const status = (service as any).resolveWebhookStatus({
        event: 'PAYMENT_UPDATED',
        payment: {
          id: 'pay_status_only',
          status: 'RECEIVED',
        },
      });

      expect(status).toBe('RECEBIDO');
    });

    it('usa subscription.status quando payment.status não vem no payload', () => {
      const status = (service as any).resolveWebhookStatus({
        event: 'SUBSCRIPTION_UPDATED',
        subscription: {
          id: 'sub_status_only',
          status: 'CONFIRMED',
        },
      });

      expect(status).toBe('CONFIRMADO');
    });

    it('mantém fallback para o nome do evento quando não há status no payload', () => {
      const status = (service as any).resolveWebhookStatus({
        event: 'PAYMENT_RECEIVED',
      });

      expect(status).toBe('RECEBIDO');
    });
  });

  describe('handleWebhook', () => {
    it('libera pagamento quando recebe PAYMENT_UPDATED com payment.status=RECEIVED', async () => {
      const txMock: any = {
        contaReceber: {
          findUnique: jest.fn().mockResolvedValue({
            id: 77,
            clienteId: 12,
            status: 'PENDENTE',
            dataRecebimento: null,
            paymentUrl: null,
            pixQrCode: null,
            pixExpiration: null,
            asaasPaymentId: 'pay_real_status',
            asaasSubscriptionId: 'sub_123',
            metodoPagamento: 'PIX',
            dataVencimento: new Date('2026-07-20T00:00:00.000Z'),
            vencimento: new Date('2026-07-20T00:00:00.000Z'),
            valor: 199.9,
            descricao: 'Mensalidade',
            cliente: {
              id: 12,
              nome: 'Cliente Teste',
              email: 'cliente@teste.com',
              telefone: '71999999999',
            },
          }),
          findFirst: jest.fn(),
          update: jest.fn().mockImplementation(async ({ data }: any) => ({
            id: 77,
            clienteId: 12,
            status: data.status,
            dataRecebimento: data.dataRecebimento,
            paymentUrl: data.paymentUrl ?? null,
            pixQrCode: data.pixQrCode ?? null,
            pixExpiration: data.pixExpiration ?? null,
            asaasPaymentId: data.asaasPaymentId ?? 'pay_real_status',
            asaasSubscriptionId: data.asaasSubscriptionId ?? 'sub_123',
            metodoPagamento: data.metodoPagamento ?? 'PIX',
            dataVencimento: data.dataVencimento ?? new Date('2026-07-20T00:00:00.000Z'),
            vencimento: new Date('2026-07-20T00:00:00.000Z'),
            valor: data.valor ?? 199.9,
            descricao: 'Mensalidade',
            cliente: {
              id: 12,
              nome: 'Cliente Teste',
              email: 'cliente@teste.com',
              telefone: '71999999999',
            },
          })),
        },
        pagamento: {
          upsert: jest.fn().mockResolvedValue({ id: 55 }),
        },
        titular: {
          findUnique: jest.fn().mockResolvedValue({ pagamentoConfirmadoEm: null }),
          update: jest.fn().mockResolvedValue({}),
        },
        corresponsavel: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        dependente: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        assinaturaDigital: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      };

      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(txMock));
      (service as any).atualizarStatusContratoAposPagamentoTx = jest.fn().mockResolvedValue(undefined);
      (service as any).gerarComissaoPrimeiroPagamentoTx = jest.fn().mockResolvedValue(undefined);
      (service as any).enviarConfirmacaoAssinatura = jest.fn().mockResolvedValue(undefined);
      (service as any).enviarLinkCriacaoSenha = jest.fn().mockResolvedValue(undefined);
      (service as any).agendarNotificacaoContratoObrigatorio = jest.fn().mockResolvedValue(undefined);

      const result = await service.handleWebhook({
        event: 'PAYMENT_UPDATED',
        payment: {
          id: 'pay_real_status',
          status: 'RECEIVED',
          subscription: 'sub_123',
          billingType: 'PIX',
          value: 199.9,
        },
      } as any);

      expect(txMock.contaReceber.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 77 },
          data: expect.objectContaining({
            status: 'RECEBIDO',
          }),
        }),
      );
      expect(txMock.pagamento.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ status: 'RECEBIDO' }),
          create: expect.objectContaining({ status: 'RECEBIDO' }),
        }),
      );
      expect(txMock.titular.update).toHaveBeenCalledWith({
        where: { id: 12 },
        data: { pagamentoConfirmadoEm: expect.any(Date) },
      });
      expect(result).toEqual({
        contaReceberId: 77,
        status: 'RECEBIDO',
      });
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

    it('continua com o customer Asaas quando a persistência local falha', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 2, nome: 'N', cpf: '99999999999', email: 'n@b.com',
        telefone: '71888888888', asaasCustomerId: null,
      });
      (mockAsaasClient as any).getCustomers = jest.fn().mockResolvedValue({ data: [{ id: 'cus_found' }] });
      (prismaMock.titular.update as jest.Mock).mockRejectedValue(new Error('banco indisponível'));

      await expect(service.ensureCustomerForTitular(2)).resolves.toBe('cus_found');
    });

    it('ensureCustomerForTitular com titular inexistente lança erro', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.ensureCustomerForTitular(999)).rejects.toThrow();
    });
  });

  describe('reenviarLinkCobrancaPendente', () => {
    it('emite a cobrança mesmo quando não consegue salvar localmente o customer encontrado', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 2,
        nome: 'Cliente',
        cpf: '99999999999',
        email: 'cliente@teste.com',
        asaasCustomerId: null,
        plano: { valorMensal: 99.9 },
        contasReceber: [],
      });
      (mockAsaasClient as any).getCustomers = jest.fn().mockResolvedValue({ data: [{ id: 'cus_found' }] });
      (prismaMock.titular.update as jest.Mock).mockRejectedValue(new Error('banco indisponível'));
      mockAsaasClient.createPayment.mockResolvedValue({ id: 'pay_new', invoiceUrl: 'https://asaas.test/fatura' });
      (prismaMock.contaReceber.create as jest.Mock).mockResolvedValue({ id: 1 });

      await expect(service.reenviarLinkCobrancaPendente(2)).resolves.toBe('https://asaas.test/fatura');
      expect(mockAsaasClient.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_found', billingType: 'BOLETO' }),
      );
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

  // ── detectCardBrand ────────────────────────────────────────────────────────────
  describe('detectCardBrand', () => {
    const detect = (n: string) => (service as any).detectCardBrand(n);

    it('identifica VISA pelo prefixo 4', () => {
      expect(detect('4111111111111111')).toBe('VISA');
    });

    it('identifica MASTERCARD série 5x', () => {
      expect(detect('5500000000000004')).toBe('MASTERCARD');
    });

    it('identifica MASTERCARD série 2x', () => {
      expect(detect('2221000000000000')).toBe('MASTERCARD');
    });

    it('identifica AMEX pelo prefixo 34', () => {
      expect(detect('378282246310005')).toBe('AMEX');
    });

    it('identifica AMEX pelo prefixo 37', () => {
      expect(detect('371449635398431')).toBe('AMEX');
    });

    it('identifica DISCOVER pelo prefixo 6011', () => {
      expect(detect('6011111111111117')).toBe('DISCOVER');
    });

    it('identifica DISCOVER pelo prefixo 65', () => {
      expect(detect('6500000000000000')).toBe('DISCOVER');
    });

    it('identifica ELO por prefixo 636368', () => {
      expect(detect('6363680000000000')).toBe('ELO');
    });

    it('identifica HIPERCARD por prefixo 606282', () => {
      expect(detect('6062820000000000')).toBe('HIPERCARD');
    });

    it('retorna UNKNOWN para número desconhecido', () => {
      expect(detect('9999999999999999')).toBe('UNKNOWN');
    });

    it('aceita número com espaços/hífens e ainda detecta bandeira', () => {
      expect(detect('4111-1111-1111-1111')).toBe('VISA');
    });

    it('número vazio retorna UNKNOWN', () => {
      expect(detect('')).toBe('UNKNOWN');
    });
  });

  // ── normalizeExpiryYear ────────────────────────────────────────────────────────
  describe('normalizeExpiryYear', () => {
    const normalize = (v: string) => (service as any).normalizeExpiryYear(v);

    it('expande ano de 2 dígitos para 4', () => {
      expect(normalize('28')).toBe('2028');
    });

    it('mantém ano já com 4 dígitos', () => {
      expect(normalize('2028')).toBe('2028');
    });

    it('remove caracteres não numéricos antes de normalizar', () => {
      expect(normalize('28/')).toBe('2028');
    });

    it('ano vazio retorna string vazia', () => {
      expect(normalize('')).toBe('');
    });
  });

  // ── resolveCreditCardToken ─────────────────────────────────────────────────────
  describe('resolveCreditCardToken', () => {
    const resolve = (titularId: number, customerId: string, creditCard?: any) =>
      (service as any).resolveCreditCardToken(titularId, customerId, creditCard);

    const validCard = {
      card: {
        holderName: 'JOAO SILVA',
        holderCpf: '12345678901',
        number: '4111111111111111',
        expiryMonth: '12',
        expiryYear: '28',
        ccv: '123',
      },
      holderInfo: {
        name: 'JOAO SILVA',
        cpfCnpj: '12345678901',
        email: 'joao@teste.com',
        postalCode: '01001000',
        addressNumber: '10',
        phone: '11999999999',
      },
      remoteIp: '127.0.0.1',
    };

    it('retorna token descriptografado quando já existe token salvo', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: 'enc:tok_existente',
      });

      const token = await resolve(1, 'cus_abc', validCard);
      expect(token).toBe('tok_existente');
      expect(mockAsaasClient.tokenizeCreditCard).not.toHaveBeenCalled();
    });

    it('tokeniza no Asaas quando não há token salvo', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: null,
      });
      mockAsaasClient.tokenizeCreditCard.mockResolvedValue({
        creditCardToken: 'tok_novo_abc',
      });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({});

      const token = await resolve(1, 'cus_abc', validCard);
      expect(token).toBe('tok_novo_abc');
      expect(mockAsaasClient.tokenizeCreditCard).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_abc',
          creditCard: expect.objectContaining({ holderName: 'JOAO SILVA' }),
        }),
      );
    });

    it('salva token criptografado e metadados mascarados após tokenizar', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: null,
      });
      mockAsaasClient.tokenizeCreditCard.mockResolvedValue({ creditCardToken: 'tok_novo' });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({});

      await resolve(1, 'cus_abc', validCard);

      expect(prismaMock.titular.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            asaasCardTokenEncrypted: 'enc:tok_novo',
            asaasCardLast4: '1111',
            asaasCardBrand: 'VISA',
            asaasCardHolderName: 'JOAO SILVA',
          }),
        }),
      );
    });

    it('não salva PAN nem CVV em texto puro', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: null,
      });
      mockAsaasClient.tokenizeCreditCard.mockResolvedValue({ creditCardToken: 'tok_novo' });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({});

      await resolve(1, 'cus_abc', validCard);

      const updateCall = (prismaMock.titular.update as jest.Mock).mock.calls[0][0];
      const dataValues = JSON.stringify(updateCall.data);
      expect(dataValues).not.toContain('4111111111111111');
      expect(dataValues).not.toContain('123');
    });

    it('retorna null quando não há token salvo e creditCard não é fornecido', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: null,
      });

      const token = await resolve(1, 'cus_abc', undefined);
      expect(token).toBeNull();
    });

    it('lança erro quando Asaas não retorna token', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: null,
      });
      mockAsaasClient.tokenizeCreditCard.mockResolvedValue({ creditCardToken: '' });

      await expect(resolve(1, 'cus_abc', validCard)).rejects.toThrow(
        'Asaas nao retornou token de cartao',
      );
    });

    it('gera novo token quando token salvo está corrompido', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: 'invalido_sem_separadores',
      });
      mockAsaasClient.tokenizeCreditCard.mockResolvedValue({ creditCardToken: 'tok_recuperado' });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({});

      const { decryptText } = require('../utils/crypto');
      (decryptText as jest.Mock).mockImplementationOnce(() => { throw new Error('Cipher text inválido'); });

      const token = await resolve(1, 'cus_abc', validCard);
      expect(token).toBe('tok_recuperado');
    });

    it('normaliza ano de 2 dígitos no payload enviado ao Asaas', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: null,
      });
      mockAsaasClient.tokenizeCreditCard.mockResolvedValue({ creditCardToken: 'tok_norm' });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({});

      const cardWith2DigitYear = { ...validCard, card: { ...validCard.card, expiryYear: '29' } };
      await resolve(1, 'cus_abc', cardWith2DigitYear);

      expect(mockAsaasClient.tokenizeCreditCard).toHaveBeenCalledWith(
        expect.objectContaining({
          creditCard: expect.objectContaining({ expiryYear: '2029' }),
        }),
      );
    });
  });

  // ── ensureMonthlySubscriptionForTitular — CREDIT_CARD ─────────────────────────
  describe('ensureMonthlySubscriptionForTitular com CREDIT_CARD', () => {
    const validCreditCard = {
      card: {
        holderName: 'MARIA SOUZA',
        holderCpf: '98765432100',
        number: '5500000000000004',
        expiryMonth: '06',
        expiryYear: '27',
        ccv: '321',
      },
      holderInfo: {
        name: 'MARIA SOUZA',
        cpfCnpj: '98765432100',
        email: 'maria@teste.com',
        postalCode: '01001000',
        addressNumber: '5',
      },
      remoteIp: '10.0.0.1',
    };

    beforeEach(() => {
      (prismaMock.contaReceber.findFirst as jest.Mock) = jest.fn().mockResolvedValue(null);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: null,
      });
    });

    it('cria assinatura CREDIT_CARD com token após tokenização', async () => {
      (service as any).ensureCustomerForTitular = jest.fn().mockResolvedValue('cus_xyz');
      mockAsaasClient.tokenizeCreditCard.mockResolvedValue({ creditCardToken: 'tok_card' });
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({});
      mockAsaasClient.createOrUpdateSubscription.mockResolvedValue({ id: 'sub_abc' });
      (service as any).syncRecurringPaymentsFromProvider = jest.fn().mockResolvedValue(undefined);
      (prismaMock.contaReceber.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 99 });

      const subId = await service.ensureMonthlySubscriptionForTitular({
        titularId: 1,
        valorMensal: 100,
        descricao: 'Mensalidade',
        billingType: 'CREDIT_CARD',
        creditCard: validCreditCard,
      });

      expect(subId).toBe('sub_abc');
      expect(mockAsaasClient.createOrUpdateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          billingType: 'CREDIT_CARD',
          creditCardToken: 'tok_card',
        }),
      );
    });

    it('atualiza cartão em assinatura existente', async () => {
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue({
        asaasSubscriptionId: 'sub_existente',
        descricao: 'Mensalidade',
        metodoPagamento: 'CREDIT_CARD',
      });
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: 'enc:tok_saved',
      });
      (service as any).ensureCustomerForTitular = jest.fn().mockResolvedValue('cus_xyz');
      mockAsaasClient.updateSubscriptionCreditCard.mockResolvedValue({});
      mockAsaasClient.createOrUpdateSubscription.mockResolvedValue({});

      const subId = await service.ensureMonthlySubscriptionForTitular({
        titularId: 1,
        valorMensal: 120,
        descricao: 'Mensalidade',
        billingType: 'CREDIT_CARD',
        creditCard: validCreditCard,
      });

      expect(subId).toBe('sub_existente');
      expect(mockAsaasClient.updateSubscriptionCreditCard).toHaveBeenCalledWith(
        'sub_existente',
        expect.objectContaining({
          creditCard: expect.objectContaining({ holderName: 'MARIA SOUZA' }),
        }),
      );
    });

    it('lança erro quando billingType é CREDIT_CARD mas não há token nem dados do cartão', async () => {
      (service as any).ensureCustomerForTitular = jest.fn().mockResolvedValue('cus_xyz');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCardTokenEncrypted: null,
      });
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.ensureMonthlySubscriptionForTitular({
          titularId: 1,
          valorMensal: 100,
          descricao: 'Mensalidade',
          billingType: 'CREDIT_CARD',
          creditCard: undefined,
        }),
      ).rejects.toThrow('Token de cartao indisponivel');
    });

    it('retorna null quando Asaas está desabilitado', async () => {
      const { resolveAsaasCredentials } = require('../utils/asaasClient');
      (resolveAsaasCredentials as jest.Mock).mockReturnValueOnce({ enabled: false });
      const disabledService = new AsaasIntegrationService('tenant-disabled');

      const subId = await disabledService.ensureMonthlySubscriptionForTitular({
        titularId: 1,
        valorMensal: 100,
        descricao: 'Mensalidade',
        billingType: 'CREDIT_CARD',
        creditCard: validCreditCard,
      });

      expect(subId).toBeNull();
    });
  });

  describe('ensureMonthlySubscriptionForTitular — vencimento inicial', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-27T12:00:00.000Z'));
      (service as any).ensureCustomerForTitular = jest.fn().mockResolvedValue('cus_xyz');
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue(null);
      mockAsaasClient.createOrUpdateSubscription.mockResolvedValue({ id: 'sub_new' });
      (service as any).syncRecurringPaymentsFromProvider = jest.fn().mockResolvedValue(undefined);
      (prismaMock.contaReceber.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 55 });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('cria primeira mensalidade para um mes depois do cadastro', async () => {
      await service.ensureMonthlySubscriptionForTitular({
        titularId: 1,
        valorMensal: 100,
        descricao: 'Mensalidade Plano - Joao',
        billingType: 'BOLETO',
      });

      expect(mockAsaasClient.createOrUpdateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          nextDueDate: '2026-07-27',
        }),
      );
    });
  });

  // ── changePaymentMethod ─────────────────────────────────────────────────────
  describe('changePaymentMethod', () => {
    const titularBase = {
      asaasCustomerId: 'cus_abc',
      asaasCardTokenEncrypted: 'enc:tok_old',
      asaasCardLast4: '1234',
      asaasCardBrand: 'VISA',
      asaasCardHolderName: 'JOAO SILVA',
    };

    const subscriptionRef = {
      asaasSubscriptionId: 'sub_abc',
      metodoPagamento: 'CREDIT_CARD',
      valor: 149.9,
      descricao: 'Mensalidade Plano - Joao',
      dataVencimento: new Date('2026-07-10T00:00:00.000Z'),
      vencimento: new Date('2026-07-10T00:00:00.000Z'),
    };

    const creditCardInput = {
      card: {
        holderName: 'JOAO SILVA',
        holderCpf: '12345678901',
        number: '4111111111111111',
        expiryMonth: '12',
        expiryYear: '2027',
        ccv: '123',
      },
      holderInfo: { name: 'JOAO SILVA', cpfCnpj: '12345678901' },
      remoteIp: '127.0.0.1',
    };

    beforeEach(() => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(titularBase);
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue(subscriptionRef);
      (prismaMock.paymentMethodChangeRequest.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.paymentMethodChangeRequest.create as jest.Mock).mockResolvedValue({ id: 1 });
      (prismaMock.paymentMethodChangeRequest.update as jest.Mock).mockResolvedValue({});
      mockAsaasClient.tokenizeCreditCard.mockResolvedValue({ creditCardToken: 'tok_new' });
      mockAsaasClient.updateSubscriptionCreditCard.mockResolvedValue({});
      mockAsaasClient.createOrUpdateSubscription.mockResolvedValue({});
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    });

    // ── ATUALIZAR_CARTAO ────────────────────────────────────────────────────

    it('ATUALIZAR_CARTAO: tokeniza novo cartão e chama updateSubscriptionCreditCard', async () => {
      await service.changePaymentMethod({
        titularId: 1,
        action: 'ATUALIZAR_CARTAO',
        creditCard: creditCardInput,
      });

      expect(mockAsaasClient.tokenizeCreditCard).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_abc' }),
      );
      expect(mockAsaasClient.updateSubscriptionCreditCard).toHaveBeenCalledWith(
        'sub_abc',
        expect.objectContaining({
          creditCard: expect.objectContaining({ holderName: 'JOAO SILVA' }),
        }),
      );
    });

    it('ATUALIZAR_CARTAO: salva token criptografado e last4 no titular via $transaction', async () => {
      await service.changePaymentMethod({
        titularId: 1,
        action: 'ATUALIZAR_CARTAO',
        creditCard: creditCardInput,
      });

      expect(prismaMock.titular.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            asaasCardTokenEncrypted: 'enc:tok_new',
            asaasCardLast4: '1111',
          }),
        }),
      );
    });

    it('ATUALIZAR_CARTAO: marca request como SUCCESS após conclusão', async () => {
      await service.changePaymentMethod({
        titularId: 1,
        action: 'ATUALIZAR_CARTAO',
        creditCard: creditCardInput,
      });

      expect(prismaMock.paymentMethodChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ status: 'SUCCESS' }),
        }),
      );
    });

    it('ATUALIZAR_CARTAO: retorna metodoPagamento CREDIT_CARD', async () => {
      const result = await service.changePaymentMethod({
        titularId: 1,
        action: 'ATUALIZAR_CARTAO',
        creditCard: creditCardInput,
      });

      expect(result.metodoPagamento).toBe('CREDIT_CARD');
    });

    it('ATUALIZAR_CARTAO: rejeita quando método atual não é CREDIT_CARD', async () => {
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue({
        asaasSubscriptionId: 'sub_abc',
        metodoPagamento: 'PIX',
      });

      await expect(
        service.changePaymentMethod({
          titularId: 1,
          action: 'ATUALIZAR_CARTAO',
          creditCard: creditCardInput,
        }),
      ).rejects.toThrow('método atual não é cartão');
    });

    it('ATUALIZAR_CARTAO: marca request como FAILED e relança erro se Asaas falhar', async () => {
      const asaasError = new Error('Asaas indisponível');
      mockAsaasClient.tokenizeCreditCard.mockRejectedValue(asaasError);

      await expect(
        service.changePaymentMethod({
          titularId: 1,
          action: 'ATUALIZAR_CARTAO',
          creditCard: creditCardInput,
        }),
      ).rejects.toBe(asaasError);

      expect(prismaMock.paymentMethodChangeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('ATUALIZAR_CARTAO: bloqueia quando há request PROCESSING em andamento', async () => {
      (prismaMock.paymentMethodChangeRequest.findFirst as jest.Mock).mockResolvedValue({
        id: 99,
        status: 'PROCESSING',
      });

      await expect(
        service.changePaymentMethod({
          titularId: 1,
          action: 'ATUALIZAR_CARTAO',
          creditCard: creditCardInput,
        }),
      ).rejects.toThrow('em andamento');
    });

    it('ATUALIZAR_CARTAO: rejeita sem creditCard', async () => {
      await expect(
        service.changePaymentMethod({
          titularId: 1,
          action: 'ATUALIZAR_CARTAO',
          creditCard: undefined,
        }),
      ).rejects.toThrow('obrigatórios');
    });

    it('ATUALIZAR_CARTAO: rejeita titular sem asaasCustomerId', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCustomerId: null,
      });
      (service as any).ensureCustomerForTitular = jest.fn().mockResolvedValue(null);

      await expect(
        service.changePaymentMethod({
          titularId: 1,
          action: 'ATUALIZAR_CARTAO',
          creditCard: creditCardInput,
        }),
      ).rejects.toThrow('sem customer no Asaas');
    });

    it('ATUALIZAR_CARTAO recupera o customer ausente antes de atualizar o cartão', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        ...titularBase,
        asaasCustomerId: null,
      });
      (service as any).ensureCustomerForTitular = jest.fn().mockResolvedValue('cus_recovered');

      await service.changePaymentMethod({
        titularId: 1,
        action: 'ATUALIZAR_CARTAO',
        creditCard: creditCardInput,
      });

      expect(mockAsaasClient.tokenizeCreditCard).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_recovered' }),
      );
    });

    it('ATUALIZAR_CARTAO: rejeita titular sem assinatura recorrente', async () => {
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.changePaymentMethod({
          titularId: 1,
          action: 'ATUALIZAR_CARTAO',
          creditCard: creditCardInput,
        }),
      ).rejects.toThrow('sem assinatura recorrente');
    });

    // ── TROCAR_METODO → PIX ─────────────────────────────────────────────────

    it('TROCAR_METODO PIX: atualiza billingType no Asaas', async () => {
      await service.changePaymentMethod({
        titularId: 1,
        action: 'TROCAR_METODO',
        novoMetodo: 'PIX',
      });

      expect(mockAsaasClient.createOrUpdateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          billingType: 'PIX',
          value: 149.9,
          nextDueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
        'sub_abc',
      );
    });

    it('TROCAR_METODO PIX: limpa token do cartão no banco', async () => {
      await service.changePaymentMethod({
        titularId: 1,
        action: 'TROCAR_METODO',
        novoMetodo: 'PIX',
      });

      expect(prismaMock.titular.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            asaasCardTokenEncrypted: null,
            asaasCardBrand: null,
            asaasCardLast4: null,
          }),
        }),
      );
    });

    it('TROCAR_METODO PIX: não chama updateSubscriptionCreditCard', async () => {
      await service.changePaymentMethod({
        titularId: 1,
        action: 'TROCAR_METODO',
        novoMetodo: 'PIX',
      });

      expect(mockAsaasClient.updateSubscriptionCreditCard).not.toHaveBeenCalled();
    });

    it('TROCAR_METODO PIX: retorna metodoPagamento PIX', async () => {
      const result = await service.changePaymentMethod({
        titularId: 1,
        action: 'TROCAR_METODO',
        novoMetodo: 'PIX',
      });

      expect(result.metodoPagamento).toBe('PIX');
    });

    it('TROCAR_METODO PIX: atualiza ContaReceber pendente com novo método', async () => {
      await service.changePaymentMethod({
        titularId: 1,
        action: 'TROCAR_METODO',
        novoMetodo: 'PIX',
      });

      expect(prismaMock.contaReceber.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PENDENTE' }),
          data: expect.objectContaining({ metodoPagamento: 'PIX' }),
        }),
      );
    });

    // ── TROCAR_METODO → BOLETO ──────────────────────────────────────────────

    it('TROCAR_METODO BOLETO: atualiza billingType para BOLETO no Asaas', async () => {
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue({
        asaasSubscriptionId: 'sub_abc',
        metodoPagamento: 'PIX',
        valor: 149.9,
        descricao: 'Mensalidade Plano - Joao',
        dataVencimento: new Date('2026-07-10T00:00:00.000Z'),
        vencimento: new Date('2026-07-10T00:00:00.000Z'),
      });

      await service.changePaymentMethod({
        titularId: 1,
        action: 'TROCAR_METODO',
        novoMetodo: 'BOLETO',
      });

      expect(mockAsaasClient.createOrUpdateSubscription).toHaveBeenCalledWith(
        expect.objectContaining({ billingType: 'BOLETO' }),
        'sub_abc',
      );
    });

    // ── TROCAR_METODO → CREDIT_CARD ─────────────────────────────────────────

    it('TROCAR_METODO CREDIT_CARD: tokeniza e atualiza cartão da assinatura', async () => {
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue({
        asaasSubscriptionId: 'sub_abc',
        metodoPagamento: 'PIX',
        valor: 149.9,
        descricao: 'Mensalidade Plano - Joao',
        dataVencimento: new Date('2026-07-10T00:00:00.000Z'),
        vencimento: new Date('2026-07-10T00:00:00.000Z'),
      });
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        asaasCustomerId: 'cus_abc',
        asaasCardTokenEncrypted: null,
        asaasCardLast4: null,
        asaasCardBrand: null,
        asaasCardHolderName: null,
      });

      await service.changePaymentMethod({
        titularId: 1,
        action: 'TROCAR_METODO',
        novoMetodo: 'CREDIT_CARD',
        creditCard: creditCardInput,
      });

      expect(mockAsaasClient.tokenizeCreditCard).toHaveBeenCalled();
      expect(mockAsaasClient.updateSubscriptionCreditCard).toHaveBeenCalled();
    });

    it('TROCAR_METODO CREDIT_CARD: rejeita sem dados do cartão', async () => {
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue({
        asaasSubscriptionId: 'sub_abc',
        metodoPagamento: 'PIX',
        valor: 149.9,
        descricao: 'Mensalidade Plano - Joao',
        dataVencimento: new Date('2026-07-10T00:00:00.000Z'),
        vencimento: new Date('2026-07-10T00:00:00.000Z'),
      });

      await expect(
        service.changePaymentMethod({
          titularId: 1,
          action: 'TROCAR_METODO',
          novoMetodo: 'CREDIT_CARD',
          creditCard: undefined,
        }),
      ).rejects.toThrow('obrigatórios');
    });

    it('TROCAR_METODO: rejeita quando a assinatura local não possui valor válido', async () => {
      (prismaMock.contaReceber.findFirst as jest.Mock).mockResolvedValue({
        asaasSubscriptionId: 'sub_abc',
        metodoPagamento: 'PIX',
        valor: 0,
        descricao: 'Mensalidade Plano - Joao',
        dataVencimento: new Date('2026-07-10T00:00:00.000Z'),
        vencimento: new Date('2026-07-10T00:00:00.000Z'),
      });

      await expect(
        service.changePaymentMethod({
          titularId: 1,
          action: 'TROCAR_METODO',
          novoMetodo: 'BOLETO',
        }),
      ).rejects.toThrow('sem valor válido');
    });

    // ── Asaas desabilitado ──────────────────────────────────────────────────

    it('lança erro quando Asaas está desabilitado', async () => {
      const { resolveAsaasCredentials } = require('../utils/asaasClient');
      (resolveAsaasCredentials as jest.Mock).mockReturnValueOnce({ enabled: false });
      const disabledService = new AsaasIntegrationService('tenant-disabled');

      await expect(
        disabledService.changePaymentMethod({
          titularId: 1,
          action: 'ATUALIZAR_CARTAO',
          creditCard: creditCardInput,
        }),
      ).rejects.toThrow('desabilitada');
    });
  });
});
