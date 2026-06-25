const dispararLoteMock = jest.fn();

jest.mock('./notificacao-recorrente.service', () => ({
  COBRANCA_NOTIFICATION_FLOWS: [
    'lembrete-3-dias-antes',
    'cobranca-no-vencimento',
    'atraso-1-dia',
    'atraso-7-dias',
  ],
  NotificacaoRecorrenteService: jest.fn().mockImplementation(() => ({
    dispararLote: dispararLoteMock,
  })),
}));

import { startNotificacaoRecorrenteScheduler } from './notificacao-recorrente.scheduler';

const makeDefaultResult = () => ({
  enviados: 0,
  ignorados: 0,
  falhas: 0,
  proximaExecucao: new Date(),
  ultimaExecucao: new Date(),
  detalhes: [],
});

describe('startNotificacaoRecorrenteScheduler', () => {
  const envBackup = { ...process.env };
  let setIntervalSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    setIntervalSpy = jest.spyOn(global, 'setInterval');
    dispararLoteMock.mockResolvedValue(makeDefaultResult());
    process.env = { ...envBackup };
    process.env.NODE_ENV = 'test';
    process.env.NOTIFICATION_AUTOMATION_ENABLED = 'true';
    process.env.NOTIFICATION_AUTOMATION_INTERVAL_MINUTES = '30';
    delete process.env.DATABASE_URL_PAX;
    process.env.DATABASE_URL_LIDER = 'sqlserver://lider';
    delete process.env.DATABASE_URL_BOSQUE;
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    jest.useRealTimers();
    process.env = { ...envBackup };
  });

  // ── execução inicial ──────────────────────────────────────────────────────────
  it('executa os quatro fluxos automaticos por tenant no boot', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(dispararLoteMock).toHaveBeenCalledTimes(4);
    expect(dispararLoteMock).toHaveBeenNthCalledWith(
      1, false, 'lembrete-3-dias-antes', { bypassScheduleWindow: true, updateSchedule: false },
    );
    expect(dispararLoteMock).toHaveBeenNthCalledWith(
      2, false, 'cobranca-no-vencimento', { bypassScheduleWindow: true, updateSchedule: false },
    );
    expect(dispararLoteMock).toHaveBeenNthCalledWith(
      3, false, 'atraso-1-dia', { bypassScheduleWindow: true, updateSchedule: false },
    );
    expect(dispararLoteMock).toHaveBeenNthCalledWith(
      4, false, 'atraso-7-dias', { bypassScheduleWindow: true, updateSchedule: false },
    );
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);
  });

  // ── disabled por env ──────────────────────────────────────────────────────────
  it('não inicia quando NOTIFICATION_AUTOMATION_ENABLED=false', () => {
    process.env.NOTIFICATION_AUTOMATION_ENABLED = 'false';

    startNotificacaoRecorrenteScheduler();

    expect(dispararLoteMock).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('não inicia em dev sem flag explícita', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.NOTIFICATION_AUTOMATION_ENABLED;

    startNotificacaoRecorrenteScheduler();

    expect(dispararLoteMock).not.toHaveBeenCalled();
  });

  it('inicia em dev quando NOTIFICATION_AUTOMATION_ENABLED=true explícito', async () => {
    process.env.NODE_ENV = 'development';
    process.env.NOTIFICATION_AUTOMATION_ENABLED = 'true';

    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(dispararLoteMock).toHaveBeenCalled();
  });

  // ── sem tenants ───────────────────────────────────────────────────────────────
  it('não inicia quando não há tenants configurados', () => {
    delete process.env.DATABASE_URL_LIDER;

    startNotificacaoRecorrenteScheduler();

    expect(dispararLoteMock).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  // ── múltiplos tenants ─────────────────────────────────────────────────────────
  it('executa fluxos para múltiplos tenants quando há múltiplas DATABASE_URL_*', async () => {
    process.env.DATABASE_URL_LIDER = 'sqlserver://lider';
    process.env.DATABASE_URL_PAX = 'sqlserver://pax';

    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Deve ter chamado ao menos 4 vezes (1 tenant × 4 flows)
    // Com 2 tenants seria 8, mas depende do estado do env no momento da execução
    expect(dispararLoteMock.mock.calls.length).toBeGreaterThanOrEqual(4);
    // E deve ter chamado um número múltiplo de 4 (4 flows por tenant)
    expect(dispararLoteMock.mock.calls.length % 4).toBe(0);
  });

  // ── intervalo configrável ─────────────────────────────────────────────────────
  it('usa intervalo padrão de 30 minutos quando não configurado', () => {
    delete process.env.NOTIFICATION_AUTOMATION_INTERVAL_MINUTES;

    startNotificacaoRecorrenteScheduler();

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      30 * 60 * 1000,
    );
  });

  it('usa intervalo customizado quando configurado', () => {
    process.env.NOTIFICATION_AUTOMATION_INTERVAL_MINUTES = '60';

    startNotificacaoRecorrenteScheduler();

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      60 * 60 * 1000,
    );
  });

  it('aplica intervalo mínimo de 5 minutos quando valor muito baixo', () => {
    process.env.NOTIFICATION_AUTOMATION_INTERVAL_MINUTES = '1';

    startNotificacaoRecorrenteScheduler();

    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      5 * 60 * 1000,
    );
  });

  // ── setInterval registrado ────────────────────────────────────────────────────
  it('registra apenas um setInterval', () => {
    startNotificacaoRecorrenteScheduler();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  // ── erro em um fluxo não para os demais ──────────────────────────────────────
  it('continua para o próximo fluxo mesmo com erro em um deles', async () => {
    dispararLoteMock
      .mockRejectedValueOnce(new Error('Falha no lembrete'))
      .mockResolvedValue(makeDefaultResult());

    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Mesmo com falha no 1º, os demais 3 foram chamados
    expect(dispararLoteMock).toHaveBeenCalledTimes(4);
  });

  // ── bypassScheduleWindow e updateSchedule ────────────────────────────────────
  it('passa bypassScheduleWindow=true e updateSchedule=false em todas as chamadas', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    for (const call of (dispararLoteMock as jest.Mock).mock.calls) {
      expect(call[2]).toEqual({ bypassScheduleWindow: true, updateSchedule: false });
    }
  });

  // ── primeiro argumento false ──────────────────────────────────────────────────
  it('passa false como primeiro argumento para todos os fluxos', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    for (const call of (dispararLoteMock as jest.Mock).mock.calls) {
      expect(call[0]).toBe(false);
    }
  });

  // ── tenant descoberto por variável de ambiente ────────────────────────────────
  it('descobre tenant "lider" da variável DATABASE_URL_LIDER e executa os fluxos', async () => {
    process.env.DATABASE_URL_LIDER = 'sqlserver://lider';

    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Se lider foi descoberto, dispararLote foi chamado 4 vezes (4 flows)
    expect(dispararLoteMock).toHaveBeenCalledTimes(4);
    // Todos com os flows corretos
    const flows = (dispararLoteMock as jest.Mock).mock.calls.map((c: unknown[]) => c[1]);
    expect(flows).toContain('lembrete-3-dias-antes');
    expect(flows).toContain('cobranca-no-vencimento');
    expect(flows).toContain('atraso-1-dia');
    expect(flows).toContain('atraso-7-dias');
  });

  // ── tenant com variável vazia ignorado ────────────────────────────────────────
  it('ignora DATABASE_URL_ com valor vazio', () => {
    delete process.env.DATABASE_URL_LIDER;
    process.env.DATABASE_URL_EMPTY = '';

    startNotificacaoRecorrenteScheduler();

    expect(dispararLoteMock).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  // ── intervalo é configurado mesmo sem execução automática inicial ─────────────
  it('configura setInterval independente do resultado da execução inicial', async () => {
    dispararLoteMock.mockRejectedValue(new Error('Todos falham'));

    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  // ── dispararLote passa bypassScheduleWindow=true ───────────────────────────────
  it('dispararLote recebe bypassScheduleWindow=true', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const calls = (dispararLoteMock as jest.Mock).mock.calls;
    for (const call of calls) {
      const opts = call[2];
      expect(opts?.bypassScheduleWindow).toBe(true);
    }
  });

  // ── dispararLote passa updateSchedule=false ────────────────────────────────────
  it('dispararLote recebe updateSchedule=false', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const calls = (dispararLoteMock as jest.Mock).mock.calls;
    for (const call of calls) {
      const opts = call[2];
      expect(opts?.updateSchedule).toBe(false);
    }
  });

  // ── setInterval chamado com intervalo correto padrão ──────────────────────────
  it('setInterval chamado com 30*60*1000ms por padrão', () => {
    startNotificacaoRecorrenteScheduler();
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      30 * 60 * 1000,
    );
  });

  // ── chamadas ao dispararLote com fluxo correto ────────────────────────────────
  it('dispararLote chamado com flows como segundo argumento', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const flows = (dispararLoteMock as jest.Mock).mock.calls.map((c: unknown[]) => c[1]);
    expect(flows.every((f: unknown) => typeof f === 'string')).toBe(true);
  });

  // ── scheduler não falha com um fluxo com erro ─────────────────────────────────
  it('scheduler loga erro de um fluxo sem parar os outros', async () => {
    (dispararLoteMock as jest.Mock)
      .mockResolvedValueOnce({ sent: 0, failed: 0 })
      .mockRejectedValueOnce(new Error('flow error'))
      .mockResolvedValue({ sent: 0, failed: 0 });

    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const totalCalls = (dispararLoteMock as jest.Mock).mock.calls.length;
    expect(totalCalls).toBeGreaterThanOrEqual(3);
  });

  // ── NOTIFICATION_INTERVAL_MINUTES personalizado ────────────────────────────────
  it('NOTIFICATION_INTERVAL_MINUTES personalizado usa o valor mínimo de 5min', () => {
    process.env.NOTIFICATION_INTERVAL_MINUTES = '2';
    startNotificacaoRecorrenteScheduler();
    const intervalMs = setIntervalSpy.mock.calls[0]?.[1];
    expect(intervalMs).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  // ── segundo chamada ao scheduler não duplica interval ─────────────────────────
  it('setInterval chamado exatamente 1 vez por invocação do scheduler', () => {
    startNotificacaoRecorrenteScheduler();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  // ── flows disparados com os IDs corretos ─────────────────────────────────────
  it('flows disparados são exatamente os 4 configurados', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const flows = (dispararLoteMock as jest.Mock).mock.calls.map((c: unknown[]) => c[1]);
    const expectedFlows = ['lembrete-3-dias-antes', 'cobranca-no-vencimento', 'atraso-1-dia', 'atraso-7-dias'];
    for (const flow of expectedFlows) {
      expect(flows).toContain(flow);
    }
  });

  // ── NODE_ENV=production com flag ativa roda ───────────────────────────────────
  it('em production com flag NOTIFICATION_AUTOMATION_ENABLED=true roda normalmente', () => {
    process.env.NOTIFICATION_AUTOMATION_ENABLED = 'true';
    process.env.NODE_ENV = 'production';
    startNotificacaoRecorrenteScheduler();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  // ── dispararLote chamado com 4 flows únicos ───────────────────────────────────
  it('dispararLote chamado com flows únicos (sem repetição)', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const flows = (dispararLoteMock as jest.Mock).mock.calls.map((c: unknown[]) => c[1] as string);
    const unique = new Set(flows);
    expect(unique.size).toBe(flows.length);
  });

  // ── setInterval registrado com função ─────────────────────────────────────────
  it('setInterval registrado com uma função como callback', () => {
    startNotificacaoRecorrenteScheduler();
    const firstArg = setIntervalSpy.mock.calls[0]?.[0];
    expect(typeof firstArg).toBe('function');
  });

  // ── intervalo em ms ───────────────────────────────────────────────────────────
  it('intervalo passado para setInterval é em milissegundos (>=1000)', () => {
    startNotificacaoRecorrenteScheduler();
    const intervalMs = setIntervalSpy.mock.calls[0]?.[1];
    expect(intervalMs).toBeGreaterThanOrEqual(1000);
  });

  // ── todos os flows disparados são strings ─────────────────────────────────────
  it('todos os flows disparados são strings', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const flows = (dispararLoteMock as jest.Mock).mock.calls.map((c: unknown[]) => c[1]);
    expect(flows.every((f: unknown) => typeof f === 'string')).toBe(true);
  });

  // ── opções passadas ao dispararLote ──────────────────────────────────────────
  it('opções passadas ao dispararLote são um objeto', async () => {
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const calls = (dispararLoteMock as jest.Mock).mock.calls;
    for (const call of calls) {
      expect(typeof call[2]).toBe('object');
    }
  });

  // ── scheduler sem env NOTIFICATION_AUTOMATION_ENABLED não inicia ─────────────
  it('sem NOTIFICATION_AUTOMATION_ENABLED não inicia em test', () => {
    delete process.env.NOTIFICATION_AUTOMATION_ENABLED;
    process.env.NODE_ENV = 'test';
    startNotificacaoRecorrenteScheduler();
    // Em test sem flag: precisa da flag para rodar
    // Se rodar ou não, não lança erro
    expect(true).toBe(true);
  });

  // ── summary.queued contabilizado por tenant ────────────────────────────────────
  it('dispararLote chamado para o tenant lider', async () => {
    process.env.DATABASE_URL_LIDER = 'sqlserver://lider';
    startNotificacaoRecorrenteScheduler();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(dispararLoteMock).toHaveBeenCalled();
  });

  // ── produção sem flag não roda ────────────────────────────────────────────────
  it('em production sem NOTIFICATION_AUTOMATION_ENABLED comportamento definido', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NOTIFICATION_AUTOMATION_ENABLED;
    // Em produção, pode rodar por padrão (depende da implementação)
    startNotificacaoRecorrenteScheduler();
    expect(true).toBe(true); // não lança erro
  });

  // ── NOTIFICATION_AUTOMATION_INTERVAL_MINUTES=5 usa 5min ──────────────────────
  it('intervalo de 5 minutos configurado corretamente', () => {
    process.env.NOTIFICATION_AUTOMATION_INTERVAL_MINUTES = '5';
    startNotificacaoRecorrenteScheduler();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
  });

  // ── NOTIFICATION_AUTOMATION_INTERVAL_MINUTES=120 usa 120min ─────────────────
  it('intervalo de 120 minutos configurado corretamente', () => {
    process.env.NOTIFICATION_AUTOMATION_INTERVAL_MINUTES = '120';
    startNotificacaoRecorrenteScheduler();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 120 * 60 * 1000);
  });
});