const prismaMock = {
  whatsappAutomationConfig: {
    findFirst: jest.fn(),
  },
  whatsappAutomationDispatch: {
    findMany: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

jest.mock('../utils/notificationClient', () => ({
  NotificationApiClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
}));

jest.mock('./notificacao-template.service', () => ({
  NotificacaoTemplateService: jest.fn().mockImplementation(() => ({
    obterDefault: jest.fn(),
  })),
}));

jest.mock('./whatsapp-notification.service', () => ({
  WhatsappNotificationService: jest.fn().mockImplementation(() => ({})),
}));

import { NotificacaoRecorrenteService } from './notificacao-recorrente.service';

describe('NotificacaoRecorrenteService.getWhatsappQueue', () => {
  let service: NotificacaoRecorrenteService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificacaoRecorrenteService('tenant-123');

    (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue({
      minIntervalMinutes: 240,
      rules: [
        {
          flow: 'pendencia-periodica',
          title: 'Pendência periódica',
        },
      ],
    });
    (prismaMock.whatsappAutomationDispatch.findMany as jest.Mock).mockResolvedValue([
      {
        recipient: '71999991111',
        sentAt: new Date('2026-06-18T08:30:00.000Z'),
      },
    ]);

    jest
      .spyOn(service as any, 'ensureAgendamento')
      .mockResolvedValue({
        id: 1,
        ativo: true,
        proximaExecucao: new Date('2026-06-18T10:00:00.000Z'),
        frequenciaMinutos: 1440,
        metodoPreferencial: 'whatsapp',
      });
    jest
      .spyOn(service as any, 'buscarPendencias')
      .mockResolvedValue([{ id: 1 }]);
    jest
      .spyOn(service as any, 'mapearDestinatarios')
      .mockReturnValue([
        {
          titularId: 1,
          nome: 'Cliente com atraso de fila',
          telefone: '71999991111',
          email: null,
          bloqueado: false,
          metodo: 'whatsapp',
          totalPendente: 200,
          proximoVencimento: '2026-06-20T00:00:00.000Z',
          quantidadeCobrancas: 1,
          cobrancas: [{ contaId: 11 }],
        },
        {
          titularId: 2,
          nome: 'Cliente bloqueado',
          telefone: '71999992222',
          email: null,
          bloqueado: true,
          metodo: 'whatsapp',
          totalPendente: 300,
          proximoVencimento: '2026-06-20T00:00:00.000Z',
          quantidadeCobrancas: 2,
          cobrancas: [{ contaId: 12 }, { contaId: 13 }],
        },
        {
          titularId: 3,
          nome: 'Cliente sem telefone',
          telefone: null,
          email: null,
          bloqueado: false,
          metodo: 'whatsapp',
          totalPendente: 150,
          proximoVencimento: '2026-06-20T00:00:00.000Z',
          quantidadeCobrancas: 1,
          cobrancas: [{ contaId: 14 }],
        },
      ]);
  });

  it('gera fila prevista com ordem, atraso e skips', async () => {
    const result = await service.getWhatsappQueue('pendencia-periodica');

    expect(result.summary).toEqual(
      expect.objectContaining({
        flow: 'pendencia-periodica',
        triggerMode: 'AUTOMATIC',
        queued: 1,
        skipped: 2,
        minIntervalMinutes: 240,
      }),
    );

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        queuePosition: 1,
        titularId: 1,
        status: 'QUEUED',
        recipient: '71999991111',
        delayedByMinutes: 150,
        blockedReason: 'Ajustado por intervalo mínimo entre envios',
      }),
    );

    expect(result.items[1]).toEqual(
      expect.objectContaining({
        titularId: 2,
        status: 'SKIPPED',
        blockedReason: 'Cliente bloqueado para notificações',
      }),
    );

    expect(result.items[2]).toEqual(
      expect.objectContaining({
        titularId: 3,
        status: 'SKIPPED',
        blockedReason: 'Cliente sem telefone válido',
      }),
    );
  });
});
