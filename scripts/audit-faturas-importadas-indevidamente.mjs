// Auditoria: identifica ContaReceber que foram importadas indevidamente do Asaas
// (pagamentos de um customer diferente do titular ao qual a conta foi associada
// localmente), causado pelo bug corrigido em syncRecurringPaymentsForTitular /
// syncRecurringPaymentsFromProvider (conta Asaas compartilhada entre tenants).
//
// Modo padrão: dry-run (apenas lista). Passe --delete para remover de fato.
// Uso:
//   node scripts/audit-faturas-importadas-indevidamente.mjs
//   node scripts/audit-faturas-importadas-indevidamente.mjs --delete
//   node scripts/audit-faturas-importadas-indevidamente.mjs --tenant=LIDER,BOSQUE

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const shouldDelete = args.includes('--delete');
const tenantArg = args.find((a) => a.startsWith('--tenant='));
const tenants = tenantArg
  ? tenantArg.split('=')[1].split(',').map((s) => s.trim().toUpperCase())
  : ['LIDER', 'BOSQUE'];

const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_BASE_URL = (process.env.ASAAS_BASE_URL || 'https://api.asaas.com/v3').replace(/\/$/, '');

if (!ASAAS_API_KEY) {
  console.error('ASAAS_API_KEY não configurada no ambiente.');
  process.exit(1);
}

async function getPaymentById(paymentId) {
  const res = await fetch(`${ASAAS_BASE_URL}/payments/${paymentId}`, {
    headers: { access_token: ASAAS_API_KEY },
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) {
    throw new Error(`Asaas respondeu ${res.status} para payment ${paymentId}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function auditTenant(tenantId) {
  const envVarName = `DATABASE_URL_${tenantId}`;
  const databaseUrl = process.env[envVarName];
  if (!databaseUrl) {
    console.error(`[${tenantId}] ${envVarName} não encontrada no .env, pulando.`);
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  console.log(`\n=== Tenant ${tenantId} ===`);

  const contas = await prisma.contaReceber.findMany({
    where: { asaasPaymentId: { not: null } },
    select: {
      id: true,
      descricao: true,
      valor: true,
      vencimento: true,
      status: true,
      clienteId: true,
      asaasPaymentId: true,
      asaasSubscriptionId: true,
      cliente: { select: { id: true, nome: true, email: true, asaasCustomerId: true } },
    },
    orderBy: { id: 'asc' },
  });

  console.log(`Total de contas com asaasPaymentId: ${contas.length}`);

  const suspeitas = [];

  for (const conta of contas) {
    const titularCustomerId = conta.cliente?.asaasCustomerId ?? null;

    if (!titularCustomerId) {
      // Conta associada a titular sem asaasCustomerId: não há como ter vindo
      // legitimamente do Asaas para este cliente. Suspeita.
      suspeitas.push({ conta, motivo: 'titular sem asaasCustomerId', paymentCustomerId: null });
      continue;
    }

    let payment;
    try {
      payment = await getPaymentById(conta.asaasPaymentId);
    } catch (err) {
      console.error(`  [ERRO] payment ${conta.asaasPaymentId} (conta ${conta.id}): ${err.message}`);
      continue;
    }

    await sleep(150); // respeita rate limit do Asaas

    if (payment.notFound) {
      suspeitas.push({ conta, motivo: 'payment não existe mais no Asaas', paymentCustomerId: null });
      continue;
    }

    const paymentCustomerId =
      typeof payment.customer === 'string' ? payment.customer : payment.customer?.id;

    if (paymentCustomerId && paymentCustomerId !== titularCustomerId) {
      suspeitas.push({ conta, motivo: 'customer do payment diverge do titular', paymentCustomerId });
    }
  }

  console.log(`\nContas suspeitas (importadas indevidamente): ${suspeitas.length}`);
  for (const s of suspeitas) {
    console.log(
      `  contaReceber.id=${s.conta.id} | cliente=${s.conta.cliente?.nome} (id=${s.conta.clienteId}, asaasCustomerId=${s.conta.cliente?.asaasCustomerId}) | ` +
        `asaasPaymentId=${s.conta.asaasPaymentId} | paymentCustomerId=${s.paymentCustomerId} | motivo="${s.motivo}" | ` +
        `valor=${s.conta.valor} vencimento=${s.conta.vencimento?.toISOString?.().slice(0, 10)} status=${s.conta.status}`,
    );
  }

  if (shouldDelete && suspeitas.length) {
    const ids = suspeitas.map((s) => s.conta.id);
    const result = await prisma.contaReceber.deleteMany({ where: { id: { in: ids } } });
    console.log(`\n[${tenantId}] Removidas ${result.count} contas.`);
  } else if (suspeitas.length) {
    console.log(`\n[${tenantId}] Dry-run: nenhuma conta removida. Rode com --delete para remover.`);
  }

  await prisma.$disconnect();
}

(async () => {
  for (const tenantId of tenants) {
    await auditTenant(tenantId);
  }
})();
