import { AsaasIntegrationService } from './asaas-integration.service';

const prismaMock = {
  contaReceber: {
    findUnique: jest.fn(),
  },
};

const mockAsaasClient = {
  getPaymentById: jest.fn(),
  confirmCashReceipt: jest.fn(),
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
          description:
            'N\u00e3o \u00e9 poss\u00edvel receber a cobran\u00e7a [782040688] pois ela n\u00e3o est\u00e1 pendente.',
        },
      },
    };
    return error;
  };

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
      expect.objectContaining({
        value: 150,
        notifyCustomer: false,
      }),
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

  it('should map RECEIVED_IN_CASH to PAYMENT_RECEIVED event', () => {
    const event = (service as any).mapEventFromStatus('RECEIVED_IN_CASH');
    expect(event).toBe('PAYMENT_RECEIVED');
  });
});
