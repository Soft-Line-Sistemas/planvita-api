import Logger from '../utils/logger';
import { AsaasIntegrationService } from './asaas-integration.service';

const logger = new Logger({ service: 'RecorrenciaSyncScheduler' });

const DEFAULT_INTERVAL_MINUTES = 30;

function discoverTenantsFromEnv(): string[] {
  const prefix = 'DATABASE_URL_';
  return Object.keys(process.env)
    .filter((key) => key.startsWith(prefix) && !!process.env[key])
    .map((key) => key.replace(prefix, '').toLowerCase())
    .filter(Boolean);
}

export function startRecorrenciaSyncScheduler() {
  const intervalMinutes = Number(
    process.env.RECORRENCIA_SYNC_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES,
  );
  const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;
  const tenants = discoverTenantsFromEnv();

  if (!tenants.length) {
    logger.warn('Scheduler de recorrência não iniciado: nenhum tenant encontrado');
    return;
  }

  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const tenantId of tenants) {
        try {
          const integration = new AsaasIntegrationService(tenantId);
          if (!integration.isEnabled()) continue;
          const result = await integration.syncRecurringPaymentsFromProvider({
            maxPages: 3,
            onlyOpen: true,
          });
          logger.info('Sync recorrente concluída', {
            tenantId,
            ...result,
          });
        } catch (error: any) {
          logger.error('Falha na sync recorrente por tenant', error, {
            tenantId,
          });
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

  logger.info('Scheduler de recorrência iniciado', {
    intervalMinutes: Math.max(5, intervalMinutes),
    tenants,
  });
}

