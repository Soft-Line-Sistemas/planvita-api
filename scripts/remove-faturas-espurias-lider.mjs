// Remove do tenant LIDER as ContaReceber espurias associadas ao titular 960
// (ALAN DEIVIDE ALVES DOS SANTOS, cadastro de teste feito em 2026-07-21).
// Essas 53 contas tem 8 asaasSubscriptionId distintos e vencimentos desde
// dezembro/2023 -- incompativel com um cadastro feito hoje. Sao pagamentos
// de outros clientes/tenants que vazaram pelo bug de sincronizacao Asaas
// (conta Asaas compartilhada, sync sem filtro por tenant).
//
// Uso:
//   node scripts/remove-faturas-espurias-lider.mjs           (dry-run)
//   node scripts/remove-faturas-espurias-lider.mjs --delete  (remove de fato)

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const shouldDelete = process.argv.includes('--delete');
const TITULAR_ID = 960;

(async () => {
  const lider = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_LIDER } } });

  const contas = await lider.contaReceber.findMany({
    where: { clienteId: TITULAR_ID },
    select: { id: true, asaasPaymentId: true, asaasSubscriptionId: true, valor: true, vencimento: true, status: true },
    orderBy: { id: 'asc' },
  });

  console.log(`ContaReceber do titular ${TITULAR_ID} no LIDER: ${contas.length}`);
  for (const c of contas) {
    console.log(
      `  id=${c.id} asaasPaymentId=${c.asaasPaymentId} asaasSubscriptionId=${c.asaasSubscriptionId} valor=${c.valor} vencimento=${c.vencimento?.toISOString?.().slice(0, 10)} status=${c.status}`,
    );
  }

  if (shouldDelete && contas.length) {
    const result = await lider.contaReceber.deleteMany({ where: { clienteId: TITULAR_ID } });
    console.log(`\nRemovidas ${result.count} contas do LIDER.`);
  } else if (contas.length) {
    console.log('\nDry-run: nada removido. Rode com --delete para remover de fato.');
  }

  await lider.$disconnect();
})();
