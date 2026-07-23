// Remove do tenant BOSQUE as ContaReceber orfas (clienteId null) cujo
// asaasPaymentId pertence, na verdade, a faturas reais do tenant LIDER.
// Essas faturas vazaram por conta de bug de sincronizacao que consultava
// pagamentos Asaas sem filtrar por tenant (conta Asaas compartilhada).
//
// Uso:
//   node scripts/remove-faturas-vazadas-bosque.mjs           (dry-run)
//   node scripts/remove-faturas-vazadas-bosque.mjs --delete  (remove de fato)

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const shouldDelete = process.argv.includes('--delete');

(async () => {
  const lider = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_LIDER } } });
  const bosque = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_BOSQUE } } });

  const liderPayments = await lider.contaReceber.findMany({
    where: { asaasPaymentId: { not: null } },
    select: { asaasPaymentId: true },
  });
  const liderPaymentIds = new Set(liderPayments.map((r) => r.asaasPaymentId));

  const bosqueOrfas = await bosque.contaReceber.findMany({
    where: { clienteId: null, asaasPaymentId: { not: null } },
    select: { id: true, asaasPaymentId: true, valor: true, vencimento: true, status: true },
    orderBy: { id: 'asc' },
  });

  const vazadas = bosqueOrfas.filter((c) => liderPaymentIds.has(c.asaasPaymentId));
  const naoIdentificadas = bosqueOrfas.filter((c) => !liderPaymentIds.has(c.asaasPaymentId));

  console.log(`BOSQUE órfãs total: ${bosqueOrfas.length}`);
  console.log(`Confirmadas como vazadas do LIDER: ${vazadas.length}`);
  for (const c of vazadas) {
    console.log(
      `  id=${c.id} asaasPaymentId=${c.asaasPaymentId} valor=${c.valor} vencimento=${c.vencimento?.toISOString?.().slice(0, 10)} status=${c.status}`,
    );
  }

  if (naoIdentificadas.length) {
    console.log(`\nATENÇÃO: ${naoIdentificadas.length} órfãs NÃO batem com nenhum payment do LIDER (não serão removidas):`);
    for (const c of naoIdentificadas) {
      console.log(`  id=${c.id} asaasPaymentId=${c.asaasPaymentId}`);
    }
  }

  if (shouldDelete && vazadas.length) {
    const result = await bosque.contaReceber.deleteMany({
      where: { id: { in: vazadas.map((c) => c.id) } },
    });
    console.log(`\nRemovidas ${result.count} contas do BOSQUE.`);
  } else if (vazadas.length) {
    console.log('\nDry-run: nada removido. Rode com --delete para remover de fato.');
  }

  await lider.$disconnect();
  await bosque.$disconnect();
})();
