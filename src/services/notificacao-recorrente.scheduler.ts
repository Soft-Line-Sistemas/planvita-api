import Logger from '../utils/logger';
import {
  COBRANCA_NOTIFICATION_FLOWS,
  NotificacaoRecorrenteService,
} from './notificacao-recorrente.service';

const logger = new Logger({ service: 'NotificacaoRecorrenteScheduler' });

const DEFAULT_INTERVAL_MINUTES = 30;

function discoverTenantsFromEnv(): string[] {
  const prefix = 'DATABASE_URL_';
  return Object.keys(process.env)
    .filter((key) => key.startsWith(prefix) && !!process.env[key])
    .map((key) => key.replace(prefix, '').toLowerCase())
    .filter(Boolean);
}

export function startNotificacaoRecorrenteScheduler() {
  const enabled = process.env.NOTIFICATION_AUTOMATION_ENABLED;
  const isDev = process.env.NODE_ENV === 'development';

  if (enabled === 'false' || (isDev && enabled !== 'true')) {
    logger.info(
      'Scheduler de notificações recorrentes desativado (dev mode ou NOTIFICATION_AUTOMATION_ENABLED=false)',
    );
    return;
  }

  const intervalMinutes = Number(
    process.env.NOTIFICATION_AUTOMATION_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES,
  );
  const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;
  const tenants = discoverTenantsFromEnv();

  if (!tenants.length) {
    logger.warn('Scheduler de notificações recorrentes não iniciado: nenhum tenant encontrado');
    return;
  }

  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const tenantId of tenants) {
        const service = new NotificacaoRecorrenteService(tenantId);
        for (const flow of COBRANCA_NOTIFICATION_FLOWS) {
          try {
            const result = await service.dispararLote(false, flow, {
              bypassScheduleWindow: true,
              updateSchedule: false,
            });
            logger.info('Fluxo automático de cobrança executado', {
              tenantId,
              flow,
              enviados: result.enviados,
              ignorados: result.ignorados,
              falhas: result.falhas,
            });
          } catch (error: any) {
            logger.error('Falha no fluxo automático de cobrança', error, {
              tenantId,
              flow,
            });
          }
        }
      }
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, intervalMs);

  logger.info('Scheduler de notificações recorrentes iniciado', {
    intervalMinutes: Math.max(5, intervalMinutes),
    tenants,
    flows: COBRANCA_NOTIFICATION_FLOWS,
  });
}
