const prismaMock = {
  whatsappAutomationConfig: {
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
  },
  whatsappAutomationRule: {
    createMany: jest.fn(),
  },
  whatsappAutomationDispatch: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const whatsappClientMock = {
  sendMessage: jest.fn(),
  getQrStatus: jest.fn(),
  isReady: jest.fn(),
  isAuthenticated: jest.fn(),
  getConnectionState: jest.fn(),
  resetSession: jest.fn(),
};

const legacyClientMock = {
  send: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

jest.mock('./whatsapp-client.service', () => ({
  getWhatsappClientForTenant: () => whatsappClientMock,
}));

jest.mock('../utils/notificationClient', () => ({
  NotificationApiClient: jest.fn().mockImplementation(() => legacyClientMock),
}));

import { WhatsappNotificationService } from './whatsapp-notification.service';

describe('WhatsappNotificationService', () => {
  let service: WhatsappNotificationService;

  const baseConfig = {
    id: 10,
    tenantId: 'tenant-123',
    enabled: true,
    useFallbackProvider: true,
    defaultCountryCode: '55',
    timezone: 'America/Bahia',
    quietHoursStart: null,
    quietHoursEnd: null,
    sendOnWeekends: true,
    minIntervalMinutes: 240,
    rules: [
      {
        id: 20,
        flow: 'pendencia-periodica',
        enabled: true,
        title: 'Pendência periódica',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WhatsappNotificationService('tenant-123');

    (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue(
      baseConfig,
    );
    (prismaMock.whatsappAutomationConfig.findUniqueOrThrow as jest.Mock).mockResolvedValue(
      baseConfig,
    );
    (prismaMock.whatsappAutomationDispatch.findFirst as jest.Mock).mockResolvedValue(
      null,
    );
    (prismaMock.whatsappAutomationDispatch.create as jest.Mock).mockResolvedValue(
      { id: 1 },
    );
    (legacyClientMock.send as jest.Mock).mockResolvedValue({
      success: true,
      provider: 'LEGACY_API',
    });
  });

  it('bloqueia envio automatico por intervalo minimo e registra skip', async () => {
    (prismaMock.whatsappAutomationDispatch.findFirst as jest.Mock).mockResolvedValue(
      {
        sentAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    );

    const result = await service.sendViaOwnConnectionOrFallback({
      flow: 'pendencia-periodica',
      recipient: '(71) 99999-0000',
      message: 'teste',
      triggerMode: 'AUTOMATIC',
      legacyPayload: {
        to: '(71) 99999-0000',
        channel: 'whatsapp',
        message: 'teste',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        skipped: true,
        provider: 'OWN',
        triggerMode: 'AUTOMATIC',
      }),
    );
    expect(whatsappClientMock.sendMessage).not.toHaveBeenCalled();
    expect(legacyClientMock.send).not.toHaveBeenCalled();
    expect(prismaMock.whatsappAutomationDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'SKIPPED',
        triggerMode: 'AUTOMATIC',
        provider: 'OWN',
        recipient: '5571999990000',
      }),
    });
  });

  it('faz fallback para API legada quando a conexao propria falha', async () => {
    (whatsappClientMock.sendMessage as jest.Mock).mockRejectedValue(
      new Error('Falha na sessao'),
    );

    const result = await service.sendViaOwnConnectionOrFallback({
      flow: 'pendencia-periodica',
      recipient: '71999990000',
      message: 'teste fallback',
      triggerMode: 'MANUAL',
      legacyPayload: {
        to: '71999990000',
        phone: '71999990000',
        channel: 'whatsapp',
        message: 'teste fallback',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        provider: 'LEGACY_API',
        fallbackUsed: true,
        triggerMode: 'FALLBACK',
      }),
    );
    expect(whatsappClientMock.sendMessage).toHaveBeenCalledWith(
      '5571999990000',
      'teste fallback',
    );
    expect(legacyClientMock.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '5571999990000',
        phone: '5571999990000',
      }),
    );
    expect(prismaMock.whatsappAutomationDispatch.create).toHaveBeenCalledTimes(2);
    expect(
      (prismaMock.whatsappAutomationDispatch.create as jest.Mock).mock.calls[0][0],
    ).toEqual({
      data: expect.objectContaining({
        status: 'FAILED',
        provider: 'OWN',
        triggerMode: 'MANUAL',
      }),
    });
    expect(
      (prismaMock.whatsappAutomationDispatch.create as jest.Mock).mock.calls[1][0],
    ).toEqual({
      data: expect.objectContaining({
        status: 'SENT',
        provider: 'LEGACY_API',
        triggerMode: 'FALLBACK',
        fallbackUsed: true,
      }),
    });
  });
});
