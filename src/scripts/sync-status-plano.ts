import dotenv from 'dotenv';
import { TitularService } from '../services/titular.service';

dotenv.config({ quiet: true });

const parseArg = (name: string) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
};

const parseTenants = () => {
  const byArg = parseArg('tenants') ?? parseArg('tenant');
  const byEnv = process.env.TENANTS ?? process.env.TENANT_ID;
  const raw = byArg ?? byEnv ?? '';
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
};

const parseBatchSize = () => {
  const byArg = parseArg('batchSize') ?? parseArg('batch');
  const byEnv = process.env.BATCH_SIZE;
  const raw = byArg ?? byEnv ?? '500';
  return Number(raw);
};

async function run() {
  const tenants = parseTenants();
  if (!tenants.length) {
    throw new Error(
      'Informe ao menos um tenant via --tenants=lider,pax ou variável TENANTS/TENANT_ID.',
    );
  }

  const batchSize = parseBatchSize();
  for (const tenant of tenants) {
    const service = new TitularService(tenant);
    const result = await service.sincronizarStatusPlanoLote(batchSize);
    console.log(
      `[${tenant}] processados=${result.totalProcessados} suspenso=${result.atualizadosSuspenso} ativo=${result.atualizadosAtivo} batch=${result.batchSize}`,
    );
  }
}

run().catch((error) => {
  console.error('[sync-status-plano] erro:', error);
  process.exit(1);
});
