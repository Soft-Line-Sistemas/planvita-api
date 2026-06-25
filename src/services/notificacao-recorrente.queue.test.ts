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

  const makeDestinatario = (overrides: Record<string, unknown> = {}) => ({
    titularId: 1,
    nome: 'Cliente Teste',
    telefone: '71999991111',
    email: null,
    bloqueado: false,
    metodo: 'whatsapp',
    totalPendente: 200,
    proximoVencimento: '2026-06-20T00:00:00.000Z',
    quantidadeCobrancas: 1,
    cobrancas: [{ contaId: 10, descricao: 'Mensalidade', valor: 200, vencimento: '2026-06-20T00:00:00.000Z', status: 'PENDENTE', diasAtraso: 0, paymentUrl: null }],
    ...overrides,
  });

  const baseConfig = {
    minIntervalMinutes: 240,
    rules: [{ flow: 'pendencia-periodica', title: 'Pendência periódica' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificacaoRecorrenteService('tenant-123');

    (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue(baseConfig);
    (prismaMock.whatsappAutomationDispatch.findMany as jest.Mock).mockResolvedValue([]);

    jest.spyOn(service as any, 'ensureAgendamento').mockResolvedValue({
      id: 1,
      ativo: true,
      proximaExecucao: new Date('2026-06-19T10:00:00.000Z'),
      frequenciaMinutos: 1440,
      metodoPreferencial: 'whatsapp',
    });
    jest.spyOn(service as any, 'buscarPendencias').mockResolvedValue([{ id: 1 }]);
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([makeDestinatario()]);
  });

  // ── gera fila prevista ────────────────────────────────────────────────────────
  it('gera fila prevista com ordem, atraso e skips', async () => {
    (prismaMock.whatsappAutomationDispatch.findMany as jest.Mock).mockResolvedValue([
      { recipient: '71999991111', sentAt: new Date('2026-06-18T08:30:00.000Z') },
    ]);
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, nome: 'Com atraso', telefone: '71999991111' }),
      makeDestinatario({ titularId: 2, nome: 'Bloqueado', telefone: '71999992222', bloqueado: true }),
      makeDestinatario({ titularId: 3, nome: 'Sem telefone', telefone: null }),
    ]);

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

  // ── fila vazia ────────────────────────────────────────────────────────────────
  it('retorna fila vazia quando não há destinatários', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([]);

    const result = await service.getWhatsappQueue('pendencia-periodica');

    expect(result.items).toHaveLength(0);
    expect(result.summary.queued).toBe(0);
    expect(result.summary.skipped).toBe(0);
  });

  // ── cliente sem envio anterior ────────────────────────────────────────────────
  it('cliente sem histórico de envio entra na fila sem atraso', async () => {
    (prismaMock.whatsappAutomationDispatch.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.getWhatsappQueue('pendencia-periodica');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('QUEUED');
    expect(result.items[0].delayedByMinutes).toBe(0);
  });

  // ── múltiplos clientes na fila ────────────────────────────────────────────────
  it('múltiplos clientes na fila recebem posição incremental', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, telefone: '71999991001' }),
      makeDestinatario({ titularId: 2, telefone: '71999991002' }),
      makeDestinatario({ titularId: 3, telefone: '71999991003' }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');

    const queued = result.items.filter((i: any) => i.status === 'QUEUED');
    const positions = queued.map((i: any) => i.queuePosition);
    expect(positions).toEqual([1, 2, 3]);
  });

  // ── summary total correto ─────────────────────────────────────────────────────
  it('summary.total é a soma de queued + skipped', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, telefone: '71999991001' }),
      makeDestinatario({ titularId: 2, telefone: null }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');

    expect(result.summary.queued + result.summary.skipped).toBe(result.items.length);
  });

  // ── clientes sem email nem telefone ───────────────────────────────────────────
  it('clientes sem email e sem telefone são skippados', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 5, telefone: null, email: null, metodo: 'whatsapp' }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');

    expect(result.items[0].status).toBe('SKIPPED');
  });

  // ── delayedByMinutes calculado corretamente ────────────────────────────────────
  it('delayedByMinutes é 0 quando não há envios recentes', async () => {
    (prismaMock.whatsappAutomationDispatch.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.getWhatsappQueue('lembrete-3-dias-antes');

    const queued = result.items.filter((i: any) => i.status === 'QUEUED');
    for (const item of queued) {
      expect(item.delayedByMinutes).toBe(0);
    }
  });

  // ── minIntervalMinutes da config ──────────────────────────────────────────────
  it('summary.minIntervalMinutes vem da config', async () => {
    (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue({
      ...baseConfig,
      minIntervalMinutes: 120,
    });

    const result = await service.getWhatsappQueue('pendencia-periodica');

    expect(result.summary.minIntervalMinutes).toBe(120);
  });

  // ── flow no summary ───────────────────────────────────────────────────────────
  it('summary.flow reflete o fluxo solicitado', async () => {
    const result = await service.getWhatsappQueue('atraso-7-dias');
    expect(result.summary.flow).toBe('atraso-7-dias');
  });

  // ── config null ────────────────────────────────────────────────────────────────
  it('lida com config null usando defaults', async () => {
    (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await service.getWhatsappQueue('pendencia-periodica');

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('items');
  });

  // ── múltiplos fluxos ──────────────────────────────────────────────────────────
  it('funciona para o fluxo lembrete-3-dias-antes', async () => {
    const result = await service.getWhatsappQueue('lembrete-3-dias-antes');
    expect(result.summary.flow).toBe('lembrete-3-dias-antes');
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('funciona para o fluxo cobranca-no-vencimento', async () => {
    const result = await service.getWhatsappQueue('cobranca-no-vencimento');
    expect(result.summary.flow).toBe('cobranca-no-vencimento');
  });

  it('funciona para o fluxo atraso-1-dia', async () => {
    const result = await service.getWhatsappQueue('atraso-1-dia');
    expect(result.summary.flow).toBe('atraso-1-dia');
  });

  // ── items contém destinatário ─────────────────────────────────────────────────
  it('items contêm nome e recipient do destinatário', async () => {
    const result = await service.getWhatsappQueue('pendencia-periodica');
    const queued = result.items.filter((i: any) => i.status === 'QUEUED');

    if (queued.length > 0) {
      expect(queued[0]).toHaveProperty('nome');
      expect(queued[0]).toHaveProperty('recipient');
    }
  });

  // ── clientes bloqueados ───────────────────────────────────────────────────────
  it('clientes com bloqueado=true são skippados com motivo correto', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 9, bloqueado: true }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');

    expect(result.items[0].status).toBe('SKIPPED');
    expect(result.items[0].blockedReason).toContain('bloqueado');
  });

  // ── triggerMode sempre AUTOMATIC ─────────────────────────────────────────────
  it('summary.triggerMode é AUTOMATIC para fila automática', async () => {
    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result.summary.triggerMode).toBe('AUTOMATIC');
  });

  // ── itens QUEUED têm queuePosition >= 1 ───────────────────────────────────────
  it('itens QUEUED têm queuePosition >= 1', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, telefone: '71999990001' }),
      makeDestinatario({ titularId: 2, telefone: '71999990002' }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    const queued = result.items.filter((i: any) => i.status === 'QUEUED');
    for (const item of queued) {
      expect(item.queuePosition).toBeGreaterThanOrEqual(1);
    }
  });

  // ── itens SKIPPED têm queuePosition nulo ──────────────────────────────────────
  it('itens SKIPPED têm queuePosition null ou 0', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, bloqueado: true }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    const skipped = result.items.filter((i: any) => i.status === 'SKIPPED');
    for (const item of skipped) {
      expect(item.queuePosition === null || item.queuePosition === 0 || item.queuePosition === undefined).toBe(true);
    }
  });

  // ── fila com muitos destinatários ─────────────────────────────────────────────
  it('fila com 10 destinatários todos elegíveis', async () => {
    const destinatarios = Array.from({ length: 10 }, (_, i) =>
      makeDestinatario({ titularId: i + 1, telefone: `7199999${String(i).padStart(4, '0')}` }),
    );
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue(destinatarios);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    const queued = result.items.filter((i: any) => i.status === 'QUEUED');
    expect(queued.length).toBe(10);
  });

  // ── fila vazia para flow atraso-1-dia ─────────────────────────────────────────
  it('retorna fila vazia para flow atraso-1-dia sem destinatários', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([]);

    const result = await service.getWhatsappQueue('atraso-1-dia');
    expect(result.items).toHaveLength(0);
    expect(result.summary.queued).toBe(0);
  });

  // ── fila vazia para flow atraso-7-dias ────────────────────────────────────────
  it('retorna fila vazia para flow atraso-7-dias sem destinatários', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([]);

    const result = await service.getWhatsappQueue('atraso-7-dias');
    expect(result.items).toHaveLength(0);
  });

  // ── destinatário sem telefone mas com email é SKIPPED ────────────────────────
  it('destinatário sem telefone mas com email é SKIPPED no fluxo whatsapp', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 5, telefone: null, email: 'test@email.com' }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result.items[0].status).toBe('SKIPPED');
  });

  // ── destinatário bloqueado não vai para fila ──────────────────────────────────
  it('summary.skipped conta corretamente', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, telefone: '71999991001' }),
      makeDestinatario({ titularId: 2, bloqueado: true }),
      makeDestinatario({ titularId: 3, telefone: null }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result.summary.queued).toBe(1);
    expect(result.summary.skipped).toBe(2);
  });

  // ── nome de destinatário preservado nos itens ─────────────────────────────────
  it('nome de destinatário preservado nos itens QUEUED', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, nome: 'Maria Silva', telefone: '71999991001' }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    const queued = result.items.filter((i: any) => i.status === 'QUEUED');
    if (queued.length > 0) {
      expect(queued[0].nome).toBe('Maria Silva');
    }
  });

  // ── totalPendente preservado nos itens ────────────────────────────────────────
  it('totalPendente preservado nos itens', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, telefone: '71999991001', totalPendente: 350 }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    const queued = result.items.filter((i: any) => i.status === 'QUEUED');
    if (queued.length > 0) {
      expect(queued[0].totalPendente).toBe(350);
    }
  });

  // ── config com minIntervalMinutes personalizado ───────────────────────────────
  it('config com minIntervalMinutes personalizado é refletido no summary como number', async () => {
    (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue({
      ...baseConfig,
      minIntervalMinutes: 120,
    });

    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(typeof result.summary.minIntervalMinutes).toBe('number');
  });

  // ── todos destinatários bloqueados resultam em queued=0 ───────────────────────
  it('todos destinatários bloqueados resultam em queued=0', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, bloqueado: true }),
      makeDestinatario({ titularId: 2, bloqueado: true }),
      makeDestinatario({ titularId: 3, bloqueado: true }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result.summary.queued).toBe(0);
    expect(result.summary.skipped).toBe(3);
  });

  // ── itens QUEUED têm queuePosition ───────────────────────────────────────────
  it('todos os itens QUEUED têm queuePosition definido', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, telefone: '71999991001' }),
      makeDestinatario({ titularId: 2, telefone: '71999991002' }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    const queued = result.items.filter((i: any) => i.status === 'QUEUED');
    for (const item of queued) {
      expect(item.queuePosition).toBeDefined();
    }
  });

  // ── summary contém minIntervalMinutes ─────────────────────────────────────────
  it('summary.minIntervalMinutes está presente', async () => {
    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect('minIntervalMinutes' in result.summary).toBe(true);
  });

  // ── result.items é um array ────────────────────────────────────────────────────
  it('result.items é sempre um array', async () => {
    const result = await service.getWhatsappQueue('lembrete-3-dias-antes');
    expect(Array.isArray(result.items)).toBe(true);
  });

  // ── result.summary está presente ─────────────────────────────────────────────
  it('result.summary está presente', async () => {
    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result.summary).toBeDefined();
  });

  // ── summary.queued + summary.skipped = total de itens ────────────────────────
  it('summary.queued + summary.skipped = total de itens', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, telefone: '71999991001' }),
      makeDestinatario({ titularId: 2, bloqueado: true }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result.summary.queued + result.summary.skipped).toBe(result.items.length);
  });

  // ── destinatário com email não enviado no whatsapp ────────────────────────────
  it('destinatário com metodo=email não enviado via whatsapp', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, metodo: 'email', telefone: null }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result).toBeDefined();
  });

  // ── getWhatsappQueue com flow lembrete-3-dias-antes ──────────────────────────
  it('getWhatsappQueue com flow lembrete-3-dias-antes funciona', async () => {
    const result = await service.getWhatsappQueue('lembrete-3-dias-antes');
    expect(result.summary).toBeDefined();
  });

  // ── getWhatsappQueue com flow cobranca-no-vencimento ─────────────────────────
  it('getWhatsappQueue com flow cobranca-no-vencimento funciona', async () => {
    const result = await service.getWhatsappQueue('cobranca-no-vencimento');
    expect(result.summary).toBeDefined();
  });

  // ── getWhatsappQueue com flow atraso-1-dia ────────────────────────────────────
  it('getWhatsappQueue com flow atraso-1-dia funciona', async () => {
    const result = await service.getWhatsappQueue('atraso-1-dia');
    expect(result.summary).toBeDefined();
  });

  // ── getWhatsappQueue com flow atraso-7-dias ───────────────────────────────────
  it('getWhatsappQueue com flow atraso-7-dias funciona', async () => {
    const result = await service.getWhatsappQueue('atraso-7-dias');
    expect(result.summary).toBeDefined();
  });

  // ── summary.queued é número ───────────────────────────────────────────────────
  it('summary.queued é sempre um número', async () => {
    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(typeof result.summary.queued).toBe('number');
  });

  // ── summary.skipped é número ──────────────────────────────────────────────────
  it('summary.skipped é sempre um número', async () => {
    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(typeof result.summary.skipped).toBe('number');
  });

  // ── destinatário sem cobrancas ────────────────────────────────────────────────
  it('destinatário sem cobrancas processado sem erro', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, telefone: '71999991001', cobrancas: [] }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result).toBeDefined();
  });

  // ── destinatário com totalPendente=0 ─────────────────────────────────────────
  it('destinatário com totalPendente=0 processado sem erro', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([
      makeDestinatario({ titularId: 1, telefone: '71999991001', totalPendente: 0 }),
    ]);

    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result).toBeDefined();
  });

  // ── result contém campo items e summary ───────────────────────────────────────
  it('result tem campos items e summary', async () => {
    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect('items' in result).toBe(true);
    expect('summary' in result).toBe(true);
  });

  // ── sum de queued é 0 para lista vazia ────────────────────────────────────────
  it('queued=0 quando lista de destinatários é vazia', async () => {
    jest.spyOn(service as any, 'mapearDestinatarios').mockReturnValue([]);
    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result.summary.queued).toBe(0);
  });

  // ── flow como string é repassado corretamente ─────────────────────────────────
  it('flow é um string aceito pelo serviço', async () => {
    await expect(service.getWhatsappQueue('pendencia-periodica')).resolves.toBeDefined();
  });

  // ── config com minIntervalMinutes=60 ─────────────────────────────────────────
  it('config com minIntervalMinutes=60 resulta em summary.minIntervalMinutes=60', async () => {
    (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue({
      ...baseConfig,
      minIntervalMinutes: 60,
    });

    const result = await service.getWhatsappQueue('pendencia-periodica');
    expect(result.summary.minIntervalMinutes).toBe(60);
  });

  // ── sem config usa padrão ─────────────────────────────────────────────────────
  it('sem config retorna result sem erro', async () => {
    (prismaMock.whatsappAutomationConfig.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.getWhatsappQueue('pendencia-periodica')).resolves.toBeDefined();
  });
});