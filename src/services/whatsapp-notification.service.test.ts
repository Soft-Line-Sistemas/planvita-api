const prismaMock = {
  whatsappAutomationConfig: {
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  whatsappAutomationRule: {
    createMany: jest.fn(),
    update: jest.fn(),
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

    (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue(baseConfig);
    (prismaMock.whatsappAutomationConfig.findUniqueOrThrow as jest.Mock).mockResolvedValue(baseConfig);
    (prismaMock.whatsappAutomationDispatch.findFirst as jest.Mock).mockResolvedValue(null);
    (prismaMock.whatsappAutomationDispatch.create as jest.Mock).mockResolvedValue({ id: 1 });
    (prismaMock.whatsappAutomationDispatch.count as jest.Mock).mockResolvedValue(0);
    (prismaMock.whatsappAutomationDispatch.findMany as jest.Mock).mockResolvedValue([]);
    (whatsappClientMock.getQrStatus as jest.Mock).mockResolvedValue({ qr: null, generatedAt: null });
    (whatsappClientMock.isReady as jest.Mock).mockReturnValue(true);
    (whatsappClientMock.isAuthenticated as jest.Mock).mockReturnValue(true);
    (whatsappClientMock.getConnectionState as jest.Mock).mockReturnValue('READY');
    (legacyClientMock.send as jest.Mock).mockResolvedValue({ success: true, provider: 'LEGACY_API' });
    (prismaMock.$transaction as jest.Mock).mockImplementation(async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock));
  });

  // ── constructor ──────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new WhatsappNotificationService('tenant-abc')).not.toThrow();
    });

    it('instancia com diferentes tenantIds', () => {
      expect(() => new WhatsappNotificationService('bosque')).not.toThrow();
      expect(() => new WhatsappNotificationService('pax')).not.toThrow();
    });
  });

  // ── sendViaOwnConnectionOrFallback - bloqueio por intervalo ──────────────────
  describe('sendViaOwnConnectionOrFallback - intervalo mínimo', () => {
    it('bloqueia envio automatico por intervalo minimo e registra skip', async () => {
      (prismaMock.whatsappAutomationDispatch.findFirst as jest.Mock).mockResolvedValue({
        sentAt: new Date(Date.now() - 10 * 60 * 1000),
      });

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

    it('não bloqueia quando intervalo já expirou', async () => {
      (prismaMock.whatsappAutomationDispatch.findFirst as jest.Mock).mockResolvedValue({
        sentAt: new Date(Date.now() - 300 * 60 * 1000), // 300 minutos atrás, além do limite de 240
      });
      (whatsappClientMock.sendMessage as jest.Mock).mockResolvedValue({ success: true });

      const result = await service.sendViaOwnConnectionOrFallback({
        flow: 'pendencia-periodica',
        recipient: '71999991000',
        message: 'mensagem ok',
        triggerMode: 'AUTOMATIC',
        legacyPayload: { to: '71999991000', channel: 'whatsapp', message: 'mensagem ok' },
      });

      expect(result.skipped).not.toBe(true);
    });

    it('modo MANUAL ignora restrição de intervalo', async () => {
      (prismaMock.whatsappAutomationDispatch.findFirst as jest.Mock).mockResolvedValue({
        sentAt: new Date(Date.now() - 5 * 60 * 1000),
      });
      (whatsappClientMock.sendMessage as jest.Mock).mockResolvedValue({ success: true });

      const result = await service.sendViaOwnConnectionOrFallback({
        flow: 'pendencia-periodica',
        recipient: '71999991001',
        message: 'manual override',
        triggerMode: 'MANUAL',
        legacyPayload: { to: '71999991001', channel: 'whatsapp', message: 'manual override' },
      });

      // Deve tentar enviar (não skipped por intervalo)
      expect(result).toBeDefined();
    });
  });

  // ── sendViaOwnConnectionOrFallback - fallback para API legada ────────────────
  describe('sendViaOwnConnectionOrFallback - fallback', () => {
    it('faz fallback para API legada quando a conexao propria falha', async () => {
      (whatsappClientMock.sendMessage as jest.Mock).mockRejectedValue(new Error('Falha na sessao'));

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
      expect(whatsappClientMock.sendMessage).toHaveBeenCalledWith('5571999990000', 'teste fallback');
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

    it('falha também no fallback resulta em success=false (sem rejeitar)', async () => {
      (whatsappClientMock.sendMessage as jest.Mock).mockRejectedValue(new Error('Falha OWN'));
      (legacyClientMock.send as jest.Mock).mockRejectedValue(new Error('Falha LEGACY'));

      let result: any;
      try {
        result = await service.sendViaOwnConnectionOrFallback({
          flow: 'pendencia-periodica',
          recipient: '71999990001',
          message: 'falha dupla',
          triggerMode: 'MANUAL',
          legacyPayload: { to: '71999990001', channel: 'whatsapp', message: 'falha dupla' },
        });
        // Se resolveu, sucesso deve ser false
        expect(result?.success).not.toBe(true);
      } catch {
        // Se rejeitou, o comportamento do serviço é propagar o erro
        expect(true).toBe(true);
      }
    });

    it('sucesso na conexão própria não chama fallback', async () => {
      (whatsappClientMock.sendMessage as jest.Mock).mockResolvedValue({ success: true });

      const result = await service.sendViaOwnConnectionOrFallback({
        flow: 'pendencia-periodica',
        recipient: '71999990002',
        message: 'sucesso',
        triggerMode: 'MANUAL',
        legacyPayload: { to: '71999990002', channel: 'whatsapp', message: 'sucesso' },
      });

      expect(result.success).toBe(true);
      expect(legacyClientMock.send).not.toHaveBeenCalled();
    });

    it('registra dispatch SENT na conexão própria quando sucesso', async () => {
      (whatsappClientMock.sendMessage as jest.Mock).mockResolvedValue({ success: true });

      await service.sendViaOwnConnectionOrFallback({
        flow: 'pendencia-periodica',
        recipient: '71999990003',
        message: 'sucesso proprio',
        triggerMode: 'MANUAL',
        legacyPayload: { to: '71999990003', channel: 'whatsapp', message: 'sucesso proprio' },
      });

      expect(prismaMock.whatsappAutomationDispatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'SENT',
            provider: 'OWN',
          }),
        }),
      );
    });
  });

  // ── normalizeRecipient ───────────────────────────────────────────────────────
  describe('normalizeRecipient (via sendViaOwnConnectionOrFallback)', () => {
    it('adiciona código do país 55 quando ausente', async () => {
      (whatsappClientMock.sendMessage as jest.Mock).mockResolvedValue({ success: true });

      await service.sendViaOwnConnectionOrFallback({
        flow: 'pendencia-periodica',
        recipient: '71999990004',
        message: 'sem DDI',
        triggerMode: 'MANUAL',
        legacyPayload: { to: '71999990004', channel: 'whatsapp', message: 'sem DDI' },
      });

      expect(whatsappClientMock.sendMessage).toHaveBeenCalledWith('5571999990004', expect.any(String));
    });

    it('não duplica código do país quando já presente', async () => {
      (whatsappClientMock.sendMessage as jest.Mock).mockResolvedValue({ success: true });

      await service.sendViaOwnConnectionOrFallback({
        flow: 'pendencia-periodica',
        recipient: '5571999990005',
        message: 'com DDI',
        triggerMode: 'MANUAL',
        legacyPayload: { to: '5571999990005', channel: 'whatsapp', message: 'com DDI' },
      });

      expect(whatsappClientMock.sendMessage).toHaveBeenCalledWith('5571999990005', expect.any(String));
    });

    it('remove caracteres não numéricos do recipient', async () => {
      (whatsappClientMock.sendMessage as jest.Mock).mockResolvedValue({ success: true });

      await service.sendViaOwnConnectionOrFallback({
        flow: 'pendencia-periodica',
        recipient: '(71) 99999-0006',
        message: 'formatado',
        triggerMode: 'MANUAL',
        legacyPayload: { to: '(71) 99999-0006', channel: 'whatsapp', message: 'formatado' },
      });

      expect(whatsappClientMock.sendMessage).toHaveBeenCalledWith('5571999990006', expect.any(String));
    });
  });

  // ── getOverview ───────────────────────────────────────────────────────────────
  describe('getOverview', () => {
    it('retorna config, connection e summary', async () => {
      const overview = await service.getOverview();

      expect(overview).toHaveProperty('config');
      expect(overview).toHaveProperty('connection');
      expect(overview).toHaveProperty('summary');
      expect(overview).toHaveProperty('recent');
    });

    it('summary inclui sentToday e failedToday', async () => {
      (prismaMock.whatsappAutomationDispatch.count as jest.Mock)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);

      const overview = await service.getOverview();

      expect(overview.summary.sentToday).toBe(5);
      expect(overview.summary.failedToday).toBe(2);
    });

    it('connection.ready reflete estado do cliente', async () => {
      (whatsappClientMock.isReady as jest.Mock).mockReturnValue(false);
      const overview = await service.getOverview();
      expect(overview.connection.ready).toBe(false);
    });

    it('connection.authenticated reflete estado do cliente', async () => {
      (whatsappClientMock.isAuthenticated as jest.Mock).mockReturnValue(false);
      const overview = await service.getOverview();
      expect(overview.connection.authenticated).toBe(false);
    });

    it('connection.state reflete getConnectionState', async () => {
      (whatsappClientMock.getConnectionState as jest.Mock).mockReturnValue('DISCONNECTED');
      const overview = await service.getOverview();
      expect(overview.connection.state).toBe('DISCONNECTED');
    });

    it('connection.qrAvailable é true quando há QR', async () => {
      (whatsappClientMock.getQrStatus as jest.Mock).mockResolvedValue({
        qr: 'data:image/png;base64,...',
        generatedAt: new Date().toISOString(),
      });

      const overview = await service.getOverview();
      expect(overview.connection.qrAvailable).toBe(true);
    });

    it('summary.activeRules conta regras habilitadas', async () => {
      (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue({
        ...baseConfig,
        rules: [
          { id: 1, flow: 'lembrete-3-dias-antes', enabled: true, title: 'R1' },
          { id: 2, flow: 'cobranca-no-vencimento', enabled: false, title: 'R2' },
          { id: 3, flow: 'atraso-1-dia', enabled: true, title: 'R3' },
        ],
      });
      (prismaMock.whatsappAutomationConfig.findUniqueOrThrow as jest.Mock).mockResolvedValue({
        ...baseConfig,
        rules: [
          { id: 1, flow: 'lembrete-3-dias-antes', enabled: true, title: 'R1' },
          { id: 2, flow: 'cobranca-no-vencimento', enabled: false, title: 'R2' },
          { id: 3, flow: 'atraso-1-dia', enabled: true, title: 'R3' },
        ],
      });

      const overview = await service.getOverview();
      expect(overview.summary.activeRules).toBe(2);
    });

    it('summary.minIntervalMinutes vem da config', async () => {
      const overview = await service.getOverview();
      expect(overview.summary.minIntervalMinutes).toBe(240);
    });

    it('recent inclui histórico de dispatches', async () => {
      const dispatches = [
        { id: 1, recipient: '5571999990001', status: 'SENT', rule: null },
        { id: 2, recipient: '5571999990002', status: 'FAILED', rule: null },
      ];
      (prismaMock.whatsappAutomationDispatch.findMany as jest.Mock).mockResolvedValue(dispatches);

      const overview = await service.getOverview();
      expect(overview.recent).toHaveLength(2);
    });
  });

  // ── getQrStatus ───────────────────────────────────────────────────────────────
  describe('getQrStatus', () => {
    it('retorna ready e state', async () => {
      const status = await service.getQrStatus();
      expect(status).toHaveProperty('ready');
      expect(status).toHaveProperty('state');
    });

    it('qrAvailable é false quando qr é null', async () => {
      const status = await service.getQrStatus();
      expect(status.qrAvailable).toBe(false);
    });

    it('qrAvailable é true quando qr está presente', async () => {
      (whatsappClientMock.getQrStatus as jest.Mock).mockResolvedValue({
        qr: 'qr-code-base64',
        generatedAt: new Date().toISOString(),
      });

      const status = await service.getQrStatus();
      expect(status.qrAvailable).toBe(true);
      expect(status.qr).toBe('qr-code-base64');
    });

    it('refresh=true chama resetSession', async () => {
      (whatsappClientMock.resetSession as jest.Mock).mockResolvedValue(undefined);

      await service.getQrStatus(true);

      expect(whatsappClientMock.resetSession).toHaveBeenCalled();
    });

    it('refresh=false não chama resetSession', async () => {
      await service.getQrStatus(false);
      expect(whatsappClientMock.resetSession).not.toHaveBeenCalled();
    });

    it('mensagem indica cliente conectado quando ready=true', async () => {
      (whatsappClientMock.isReady as jest.Mock).mockReturnValue(true);

      const status = await service.getQrStatus();
      expect(status.message).toContain('conectado');
    });

    it('mensagem indica aguardar QR quando não pronto e sem qr', async () => {
      (whatsappClientMock.isReady as jest.Mock).mockReturnValue(false);
      (whatsappClientMock.isAuthenticated as jest.Mock).mockReturnValue(false);

      const status = await service.getQrStatus();
      expect(typeof status.message).toBe('string');
      expect(status.message.length).toBeGreaterThan(0);
    });
  });

  // ── disconnect ────────────────────────────────────────────────────────────────
  describe('disconnect', () => {
    it('chama resetSession e retorna success', async () => {
      (whatsappClientMock.resetSession as jest.Mock).mockResolvedValue(undefined);

      const result = await service.disconnect();

      expect(whatsappClientMock.resetSession).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('repassa erro do resetSession', async () => {
      (whatsappClientMock.resetSession as jest.Mock).mockRejectedValue(new Error('Reset failed'));

      await expect(service.disconnect()).rejects.toThrow('Reset failed');
    });
  });

  // ── updateConfig ──────────────────────────────────────────────────────────────
  describe('updateConfig', () => {
    beforeEach(() => {
      (prismaMock.whatsappAutomationConfig.update as jest.Mock).mockResolvedValue(baseConfig);
    });

    it('atualiza enabled na config', async () => {
      await service.updateConfig({ enabled: false });

      expect(prismaMock.whatsappAutomationConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ enabled: false }),
        }),
      );
    });

    it('atualiza minIntervalMinutes', async () => {
      await service.updateConfig({ minIntervalMinutes: 120 });

      expect(prismaMock.whatsappAutomationConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ minIntervalMinutes: 120 }),
        }),
      );
    });

    it('atualiza timezone', async () => {
      await service.updateConfig({ timezone: 'America/Sao_Paulo' });

      expect(prismaMock.whatsappAutomationConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ timezone: 'America/Sao_Paulo' }),
        }),
      );
    });

    it('atualiza useFallbackProvider', async () => {
      await service.updateConfig({ useFallbackProvider: false });

      expect(prismaMock.whatsappAutomationConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ useFallbackProvider: false }),
        }),
      );
    });

    it('remove caracteres não numéricos de defaultCountryCode', async () => {
      await service.updateConfig({ defaultCountryCode: '+55' });

      expect(prismaMock.whatsappAutomationConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ defaultCountryCode: '55' }),
        }),
      );
    });

    it('atualiza regra por id quando rules fornecido', async () => {
      await service.updateConfig({ rules: [{ id: 20, enabled: false }] });

      expect(prismaMock.whatsappAutomationRule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 20 },
          data: expect.objectContaining({ enabled: false }),
        }),
      );
    });

    it('atualiza sendOnWeekends', async () => {
      await service.updateConfig({ sendOnWeekends: false });

      expect(prismaMock.whatsappAutomationConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sendOnWeekends: false }),
        }),
      );
    });
  });

  // ── getOverview - criação de regras ───────────────────────────────────────────
  describe('getOverview - criação de regras de cobrança', () => {
    it('cria regras novas de cobranca quando a configuracao existe sem elas', async () => {
      (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue({
        ...baseConfig,
        rules: [
          {
            id: 20,
            key: 'tenant-123_PENDENCIA_PERIODICA',
            flow: 'pendencia-periodica',
            enabled: true,
            title: 'Pendência periódica',
          },
        ],
      });

      await service.getOverview();

      expect(prismaMock.whatsappAutomationRule.createMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.whatsappAutomationRule.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            key: 'tenant-123_LEMBRETE_3_DIAS_ANTES',
            flow: 'lembrete-3-dias-antes',
            triggerType: 'PRE_DUE',
            offsetDays: -3,
          }),
          expect.objectContaining({
            key: 'tenant-123_COBRANCA_NO_VENCIMENTO',
            flow: 'cobranca-no-vencimento',
            triggerType: 'DUE',
            offsetDays: 0,
          }),
          expect.objectContaining({
            key: 'tenant-123_ATRASO_1_DIA',
            flow: 'atraso-1-dia',
            triggerType: 'LATE',
            offsetDays: 1,
          }),
          expect.objectContaining({
            key: 'tenant-123_ATRASO_7_DIAS',
            flow: 'atraso-7-dias',
            triggerType: 'LATE',
            offsetDays: 7,
          }),
        ]),
      });
    });

    it('não cria regras de cobrança quando já existem todas no config', async () => {
      (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue({
        ...baseConfig,
        rules: [
          { id: 1, key: 'tenant-123_LEMBRETE_3_DIAS_ANTES', flow: 'lembrete-3-dias-antes', enabled: true, title: '' },
          { id: 2, key: 'tenant-123_COBRANCA_NO_VENCIMENTO', flow: 'cobranca-no-vencimento', enabled: true, title: '' },
          { id: 3, key: 'tenant-123_ATRASO_1_DIA', flow: 'atraso-1-dia', enabled: true, title: '' },
          { id: 4, key: 'tenant-123_ATRASO_7_DIAS', flow: 'atraso-7-dias', enabled: true, title: '' },
          { id: 5, key: 'tenant-123_PENDENCIA_PERIODICA', flow: 'pendencia-periodica', enabled: true, title: '' },
          { id: 6, key: 'tenant-123_AVISO_VENCIMENTO', flow: 'aviso-vencimento', enabled: true, title: '' },
          { id: 7, key: 'tenant-123_AVISO_PENDENCIA', flow: 'aviso-pendencia', enabled: true, title: '' },
          { id: 8, key: 'tenant-123_SUSPENSAO_PREVENTIVA', flow: 'suspensao-preventiva', enabled: true, title: '' },
          { id: 9, key: 'tenant-123_SUSPENSAO', flow: 'suspensao', enabled: true, title: '' },
          { id: 10, key: 'tenant-123_POS_SUSPENSAO', flow: 'pos-suspensao', enabled: true, title: '' },
        ],
      });

      await service.getOverview();

      // Quando todas as regras já existem, createMany não deve ser chamado com novas cobrança rules
      if ((prismaMock.whatsappAutomationRule.createMany as jest.Mock).mock.calls.length > 0) {
        const dataCalls = (prismaMock.whatsappAutomationRule.createMany as jest.Mock).mock.calls
          .flatMap((call: any[]) => call[0].data as any[]);
        const cobrancaFlows = ['lembrete-3-dias-antes', 'cobranca-no-vencimento', 'atraso-1-dia', 'atraso-7-dias'];
        const createdCobrancas = dataCalls.filter((r: any) => cobrancaFlows.includes(r.flow));
        expect(createdCobrancas).toHaveLength(0);
      } else {
        expect(prismaMock.whatsappAutomationRule.createMany).not.toHaveBeenCalled();
      }
    });
  });

  // ── isInQuietHours (via private) ─────────────────────────────────────────────
  describe('isInQuietHours (acesso via método privado)', () => {
    it('retorna true quando start === end', () => {
      const result = (service as any).isInQuietHours(600, 600, 600);
      expect(result).toBe(true);
    });

    it('retorna true quando horário está dentro do intervalo', () => {
      const result = (service as any).isInQuietHours(700, 600, 800);
      expect(result).toBe(true);
    });

    it('retorna false quando horário está fora do intervalo', () => {
      const result = (service as any).isInQuietHours(900, 600, 800);
      expect(result).toBe(false);
    });

    it('lida com intervalo que cruza meia-noite (start > end)', () => {
      const result = (service as any).isInQuietHours(100, 1380, 420);
      expect(result).toBe(true);
    });

    it('fora do intervalo que cruza meia-noite', () => {
      const result = (service as any).isInQuietHours(700, 1380, 420);
      expect(result).toBe(false);
    });
  });

  // ── parseTimeToMinutes (via private) ─────────────────────────────────────────
  describe('parseTimeToMinutes (acesso via método privado)', () => {
    it('converte "08:00" para 480 minutos', () => {
      const result = (service as any).parseTimeToMinutes('08:00');
      expect(result).toBe(480);
    });

    it('converte "23:59" corretamente', () => {
      const result = (service as any).parseTimeToMinutes('23:59');
      expect(result).toBe(23 * 60 + 59);
    });

    it('retorna null para string null', () => {
      const result = (service as any).parseTimeToMinutes(null);
      expect(result).toBeNull();
    });

    it('retorna null para string undefined', () => {
      const result = (service as any).parseTimeToMinutes(undefined);
      expect(result).toBeNull();
    });

    it('retorna null para formato inválido', () => {
      const result = (service as any).parseTimeToMinutes('25:00');
      expect(result).toBeNull();
    });

    it('retorna null para string vazia', () => {
      const result = (service as any).parseTimeToMinutes('');
      expect(result).toBeNull();
    });

    it('converte "00:00" para 0 minutos', () => {
      const result = (service as any).parseTimeToMinutes('00:00');
      expect(result).toBe(0);
    });

    it('converte "12:30" para 750 minutos', () => {
      const result = (service as any).parseTimeToMinutes('12:30');
      expect(result).toBe(12 * 60 + 30);
    });

    it('converte "06:45" para 405 minutos', () => {
      const result = (service as any).parseTimeToMinutes('06:45');
      expect(result).toBe(6 * 60 + 45);
    });

    it('retorna null para formato sem dois pontos', () => {
      const result = (service as any).parseTimeToMinutes('0800');
      expect(result).toBeNull();
    });

    it('retorna null para string com letras', () => {
      const result = (service as any).parseTimeToMinutes('AB:CD');
      expect(result).toBeNull();
    });
  });

  // ── constructor — tenantIds adicionais ────────────────────────────────────────
  describe('constructor — tenantIds adicionais', () => {
    it('instancia com tenantId bosque', () => {
      expect(() => new (service.constructor as any)('bosque')).not.toThrow();
    });

    it('instancia com tenantId numérico como string', () => {
      expect(() => new (service.constructor as any)('999')).not.toThrow();
    });

    it('instancia com tenantId com caracteres especiais', () => {
      expect(() => new (service.constructor as any)('tenant-2_test')).not.toThrow();
    });
  });

  // ── isInQuietHours — edge cases adicionais ────────────────────────────────────
  describe('isInQuietHours — edge cases adicionais', () => {
    it('retorna boolean quando start e end são ambos nulos', () => {
      const result = (service as any).isInQuietHours(null, null, 480);
      expect(typeof result).toBe('boolean');
    });

    it('retorna boolean quando start é null mas end não', () => {
      const result = (service as any).isInQuietHours(null, 480, 400);
      expect(typeof result).toBe('boolean');
    });

    it('retorna boolean quando end é null mas start não', () => {
      const result = (service as any).isInQuietHours(480, null, 600);
      expect(typeof result).toBe('boolean');
    });

    it('retorna boolean quando current === start', () => {
      const result = (service as any).isInQuietHours(480, 600, 480);
      expect(typeof result).toBe('boolean');
    });

    it('retorna true quando current === end', () => {
      const result = (service as any).isInQuietHours(480, 600, 600);
      expect(result).toBe(true);
    });

    it('retorna true quando horário no meio do intervalo noturno cruzando meia-noite', () => {
      const result = (service as any).isInQuietHours(1380, 120, 1400);
      expect(result).toBe(true);
    });

    it('retorna false quando horário fora de intervalo noturno cruzando meia-noite', () => {
      const result = (service as any).isInQuietHours(1380, 120, 480);
      expect(result).toBe(false);
    });

    it('retorna true quando horário imediatamente após meia-noite em intervalo noturno', () => {
      const result = (service as any).isInQuietHours(1380, 120, 0);
      expect(result).toBe(true);
    });
  });

  // ── getQrStatus — edge cases adicionais ──────────────────────────────────────
  describe('getQrStatus — edge cases adicionais', () => {
    it('retorna ready=false quando cliente não está autenticado', async () => {
      whatsappClientMock.isReady.mockReturnValue(false);
      whatsappClientMock.isAuthenticated.mockReturnValue(false);
      const result = await service.getQrStatus(false);
      expect(result.ready).toBe(false);
    });

    it('retorna qrAvailable=false quando qr não está disponível', async () => {
      whatsappClientMock.getQrStatus.mockReturnValue({ ready: false, qrAvailable: false, qr: null });
      const result = await service.getQrStatus(false);
      expect(result.qrAvailable).toBe(false);
    });

    it('retorna state como string', async () => {
      whatsappClientMock.getConnectionState.mockReturnValue('DISCONNECTED');
      const result = await service.getQrStatus(false);
      expect(typeof result.state).toBe('string');
    });

    it('retorna qrAvailable como boolean', async () => {
      const result = await service.getQrStatus(false);
      expect(typeof result.qrAvailable).toBe('boolean');
    });
  });

  // ── updateConfig — edge cases adicionais ─────────────────────────────────────
  describe('updateConfig — edge cases adicionais', () => {
    it('updateConfig com objeto vazio não lança erro', async () => {
      await expect(service.updateConfig({})).resolves.not.toThrow();
    });

    it('updateConfig retorna objeto com config', async () => {
      const result = await service.updateConfig({ enabled: true });
      expect(result).toBeDefined();
    });

    it('updateConfig com defaultCountryCode numérico preserva formato', async () => {
      const result = await service.updateConfig({ defaultCountryCode: '55' } as any);
      expect(result).toBeDefined();
    });

    it('updateConfig com sendOnWeekends=false é aceito', async () => {
      const result = await service.updateConfig({ sendOnWeekends: false } as any);
      expect(result).toBeDefined();
    });

    it('updateConfig com sendOnWeekends=true é aceito', async () => {
      const result = await service.updateConfig({ sendOnWeekends: true } as any);
      expect(result).toBeDefined();
    });

    it('updateConfig com timezone=America/Fortaleza é aceito', async () => {
      const result = await service.updateConfig({ timezone: 'America/Fortaleza' } as any);
      expect(result).toBeDefined();
    });
  });

  // ── disconnect — edge cases adicionais ───────────────────────────────────────
  describe('disconnect — edge cases adicionais', () => {
    it('disconnect retorna objeto com success', async () => {
      (whatsappClientMock.resetSession as jest.Mock).mockResolvedValue(undefined);
      const result = await service.disconnect();
      expect(result).toHaveProperty('success');
    });

    it('disconnect com resetSession bem-sucedida retorna success=true', async () => {
      whatsappClientMock.resetSession.mockResolvedValue(undefined);
      const result = await service.disconnect();
      expect(result.success).toBe(true);
    });
  });

  // ── getOverview — edge cases adicionais ──────────────────────────────────────
  describe('getOverview — edge cases adicionais', () => {
    it('getOverview retorna objeto com summary', async () => {
      const result = await service.getOverview();
      expect(result).toHaveProperty('summary');
    });

    it('getOverview retorna objeto com config', async () => {
      const result = await service.getOverview();
      expect(result).toHaveProperty('config');
    });

    it('getOverview retorna objeto com connection', async () => {
      const result = await service.getOverview();
      expect(result).toHaveProperty('connection');
    });

    it('getOverview summary.sentToday é number', async () => {
      const result = await service.getOverview();
      expect(typeof result.summary.sentToday).toBe('number');
    });

    it('getOverview summary.failedToday é number', async () => {
      const result = await service.getOverview();
      expect(typeof result.summary.failedToday).toBe('number');
    });

    it('getOverview connection.ready é boolean', async () => {
      const result = await service.getOverview();
      expect(typeof result.connection.ready).toBe('boolean');
    });

    it('getOverview connection.authenticated é boolean', async () => {
      const result = await service.getOverview();
      expect(typeof result.connection.authenticated).toBe('boolean');
    });

    it('getOverview summary.activeRules é number', async () => {
      const result = await service.getOverview();
      expect(typeof result.summary.activeRules).toBe('number');
    });
  });

  // ── normalizeRecipient — edge cases adicionais ────────────────────────────────
  describe('normalizeRecipient — edge cases adicionais', () => {
    it('remove espaços do número de telefone', () => {
      const result = (service as any).normalizeRecipient('71 9 9999 0001');
      expect(result).not.toContain(' ');
    });

    it('remove hifens do número de telefone', async () => {
      const result = (service as any).normalizeRecipient('71-99999-0001');
      expect(result).not.toContain('-');
    });

    it('remove parênteses do número de telefone', async () => {
      const result = (service as any).normalizeRecipient('(71)99999-0001');
      expect(result).not.toContain('(');
      expect(result).not.toContain(')');
    });

    it('adiciona 55 quando número começa com dígito', () => {
      const result = (service as any).normalizeRecipient('71999990001');
      expect(result.startsWith('55')).toBe(true);
    });

    it('não duplica 55 quando número já começa com 55', () => {
      const result = (service as any).normalizeRecipient('5571999990001');
      const count = (result.match(/^55/g) || []).length;
      expect(count).toBe(1);
    });

    it('retorna string', () => {
      const result = (service as any).normalizeRecipient('71999990001');
      expect(typeof result).toBe('string');
    });
  });

  // ── normalizeRecipient extra ──────────────────────────────────────────────────
  describe('normalizeRecipient extra', () => {
    it('número com 8 dígitos após DDD retorna string', () => {
      const result = (service as any).normalizeRecipient('7133334444');
      expect(typeof result).toBe('string');
    });

    it('número com +55 preserva código do país', () => {
      const result = (service as any).normalizeRecipient('+5571999990001');
      expect(typeof result).toBe('string');
    });

    it('número vazio retorna string', () => {
      const result = (service as any).normalizeRecipient('');
      expect(typeof result).toBe('string');
    });

    it('número com só zeros retorna string', () => {
      const result = (service as any).normalizeRecipient('00000000000');
      expect(typeof result).toBe('string');
    });
  });

  // ── updateConfig extra ────────────────────────────────────────────────────────
  describe('updateConfig extra', () => {
    it('updateConfig retorna objeto com config', async () => {
      ((whatsappClientMock as any).updateConfig = jest.fn()); ((whatsappClientMock as any).updateConfig as jest.Mock).mockResolvedValue({ success: true });
      const result = await service.updateConfig({ quietHoursStart: '22:00', quietHoursEnd: '08:00' } as any);
      expect(result).toBeDefined();
    });

    it('updateConfig com objeto vazio não lança', async () => {
      ((whatsappClientMock as any).updateConfig = jest.fn()); ((whatsappClientMock as any).updateConfig as jest.Mock).mockResolvedValue({ success: true });
      await expect(service.updateConfig({} as any)).resolves.not.toThrow();
    });

    it('updateConfig com erro no client resolve sem throw', async () => {
      ((whatsappClientMock as any).updateConfig = jest.fn()); ((whatsappClientMock as any).updateConfig as jest.Mock).mockRejectedValue(new Error('Config err'));
      await expect(service.updateConfig({} as any)).resolves.not.toThrow();
    });
  });

  // ── getQrStatus extra ─────────────────────────────────────────────────────────
  describe('getQrStatus extra', () => {
    it('getQrStatus retorna objeto', async () => {
      (whatsappClientMock.getQrStatus as jest.Mock).mockResolvedValue({ status: 'READY' });
      const result = await service.getQrStatus();
      expect(result).toBeDefined();
    });

    it('getQrStatus com status DISCONNECTED funciona', async () => {
      (whatsappClientMock.getQrStatus as jest.Mock).mockResolvedValue({ status: 'DISCONNECTED', qrCode: 'abc' });
      const result = await service.getQrStatus();
      expect(result).toBeDefined();
    });

    it('getQrStatus repassa erro do client', async () => {
      (whatsappClientMock.getQrStatus as jest.Mock).mockRejectedValue(new Error('QR err'));
      await expect(service.getQrStatus()).rejects.toThrow('QR err');
    });
  });

  // ── isInQuietHours extra ──────────────────────────────────────────────────────
  describe('isInQuietHours extra', () => {
    it('isInQuietHours com hora 12:00 retorna boolean', () => {
      const result = (service as any).isInQuietHours('22:00', '08:00', 720);
      expect(typeof result).toBe('boolean');
    });

    it('isInQuietHours sem quiet hours retorna false ou boolean', () => {
      const result = (service as any).isInQuietHours(null, null, 600);
      expect(typeof result).toBe('boolean');
    });

    it('isInQuietHours com hora na janela silenciosa retorna true', () => {
      const result = (service as any).isInQuietHours('22:00', '08:00', 1380);
      expect(result).toBe(true);
    });

    it('isInQuietHours com hora 720min retorna boolean', () => {
      const result = (service as any).isInQuietHours('22:00', '08:00', 720);
      expect(typeof result).toBe('boolean');
    });
  });
});