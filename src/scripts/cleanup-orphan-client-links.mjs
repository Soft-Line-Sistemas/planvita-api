import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TENANTS = [
  { id: 'PAX', envVar: 'DATABASE_URL_PAX' },
  { id: 'LIDER', envVar: 'DATABASE_URL_LIDER' },
  { id: 'BOSQUE', envVar: 'DATABASE_URL_BOSQUE' },
];

function getArgValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parseTenantFilter() {
  const raw = getArgValue('--tenant');
  if (!raw) return null;
  return raw
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function buildClient(url) {
  return new PrismaClient({
    datasources: { db: { url } },
  });
}

async function tableExists(prisma, tableName) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 AS found FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${tableName}'`,
  );
  return rows.length > 0;
}

async function deleteIfTableExists(prisma, tableName, whereClause) {
  if (!(await tableExists(prisma, tableName))) return 0;
  return Number(
    await prisma.$executeRawUnsafe(`DELETE FROM ${tableName} WHERE ${whereClause}`),
  );
}

async function countIfTableExists(prisma, tableName, whereClause) {
  if (!(await tableExists(prisma, tableName))) return 0;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(1) AS total FROM ${tableName} WHERE ${whereClause}`,
  );
  return Number(rows?.[0]?.total ?? 0);
}

async function processTenant(tenant, execute) {
  const url = process.env[tenant.envVar];
  if (!url) {
    throw new Error(`Variável ${tenant.envVar} não definida`);
  }

  const prisma = buildClient(url);

  try {
    const summarize = {
      dependente: await countIfTableExists(
        prisma,
        'Dependente',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Dependente.titularId)`,
      ),
      corresponsavel: await countIfTableExists(
        prisma,
        'Corresponsavel',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Corresponsavel.titularId)`,
      ),
      pagamento: await countIfTableExists(
        prisma,
        'Pagamento',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Pagamento.titularId)`,
      ),
      documento: await countIfTableExists(
        prisma,
        'Documento',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Documento.titularId)`,
      ),
      comissao: await countIfTableExists(
        prisma,
        'Comissao',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Comissao.titularId)`,
      ),
      contaReceber: await countIfTableExists(
        prisma,
        'ContaReceber',
        `clienteId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = ContaReceber.clienteId)`,
      ),
      orcamento: await countIfTableExists(
        prisma,
        'Orcamento',
        `clienteId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Orcamento.clienteId)`,
      ),
      recibo: await countIfTableExists(
        prisma,
        'Recibo',
        `clienteId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Recibo.clienteId)`,
      ),
      titularCredential: await countIfTableExists(
        prisma,
        'TitularCredential',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = TitularCredential.titularId)`,
      ),
      titularOtp: await countIfTableExists(
        prisma,
        'TitularOtp',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = TitularOtp.titularId)`,
      ),
      titularToken: await countIfTableExists(
        prisma,
        'TitularToken',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = TitularToken.titularId)`,
      ),
      assinaturaDigital: await countIfTableExists(
        prisma,
        'AssinaturaDigital',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = AssinaturaDigital.titularId)`,
      ),
      parceriaVantagemResgate: await countIfTableExists(
        prisma,
        'ParceriaVantagemResgate',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = ParceriaVantagemResgate.titularId)`,
      ),
      consentAcceptances: await countIfTableExists(
        prisma,
        'consent_acceptances',
        `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = consent_acceptances.titularId)`,
      ),
    };

    console.log(`\n[${tenant.id}] órfãos encontrados`);
    Object.entries(summarize).forEach(([key, value]) => {
      console.log(`- ${key}: ${value}`);
    });

    if (!execute) return;

    const deleted = {};
    deleted.notificationLog = await deleteIfTableExists(
      prisma,
      'NotificationLog',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = NotificationLog.titularId)`,
    );
    deleted.whatsappDispatchTitular = await deleteIfTableExists(
      prisma,
      'WhatsappAutomationDispatch',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = WhatsappAutomationDispatch.titularId)`,
    );
    deleted.financialAuditContaReceber = await deleteIfTableExists(
      prisma,
      'FinancialAudit',
      `entityType = 'ContaReceber' AND NOT EXISTS (SELECT 1 FROM ContaReceber c WHERE c.id = FinancialAudit.entityId)`,
    );
    deleted.whatsappDispatchContaReceber = await deleteIfTableExists(
      prisma,
      'WhatsappAutomationDispatch',
      `contaReceberId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ContaReceber c WHERE c.id = WhatsappAutomationDispatch.contaReceberId)`,
    );
    deleted.paymentMethodChangeRequest = await deleteIfTableExists(
      prisma,
      'PaymentMethodChangeRequest',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = PaymentMethodChangeRequest.titularId)`,
    );
    deleted.consentAcceptances = await deleteIfTableExists(
      prisma,
      'consent_acceptances',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = consent_acceptances.titularId)`,
    );
    deleted.titularCredential = await deleteIfTableExists(
      prisma,
      'TitularCredential',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = TitularCredential.titularId)`,
    );
    deleted.titularOtp = await deleteIfTableExists(
      prisma,
      'TitularOtp',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = TitularOtp.titularId)`,
    );
    deleted.titularToken = await deleteIfTableExists(
      prisma,
      'TitularToken',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = TitularToken.titularId)`,
    );
    deleted.assinaturaDigital = await deleteIfTableExists(
      prisma,
      'AssinaturaDigital',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = AssinaturaDigital.titularId)`,
    );
    deleted.documento = await deleteIfTableExists(
      prisma,
      'Documento',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Documento.titularId)`,
    );
    deleted.parceriaVantagemResgate = await deleteIfTableExists(
      prisma,
      'ParceriaVantagemResgate',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = ParceriaVantagemResgate.titularId)`,
    );
    deleted.dependente = await deleteIfTableExists(
      prisma,
      'Dependente',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Dependente.titularId)`,
    );
    deleted.corresponsavel = await deleteIfTableExists(
      prisma,
      'Corresponsavel',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Corresponsavel.titularId)`,
    );
    deleted.pagamento = await deleteIfTableExists(
      prisma,
      'Pagamento',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Pagamento.titularId)`,
    );
    deleted.comissao = await deleteIfTableExists(
      prisma,
      'Comissao',
      `titularId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Comissao.titularId)`,
    );
    deleted.contaReceber = await deleteIfTableExists(
      prisma,
      'ContaReceber',
      `clienteId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = ContaReceber.clienteId)`,
    );
    deleted.orcamento = await deleteIfTableExists(
      prisma,
      'Orcamento',
      `clienteId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Orcamento.clienteId)`,
    );
    deleted.recibo = await deleteIfTableExists(
      prisma,
      'Recibo',
      `clienteId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM Titular t WHERE t.id = Recibo.clienteId)`,
    );

    console.log(`\n[${tenant.id}] órfãos removidos`);
    Object.entries(deleted).forEach(([key, value]) => {
      console.log(`- ${key}: ${Number(value ?? 0)}`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const execute = hasFlag('--execute');
  const tenantFilter = parseTenantFilter();
  const tenants = tenantFilter
    ? TENANTS.filter((tenant) => tenantFilter.includes(tenant.id))
    : TENANTS;

  if (tenants.length === 0) {
    throw new Error('Nenhum tenant válido informado');
  }

  console.log(
    execute
      ? 'Executando limpeza de vínculos órfãos de cliente.'
      : 'Modo dry-run: nenhuma exclusão será executada.',
  );

  for (const tenant of tenants) {
    await processTenant(tenant, execute);
  }
}

main().catch((error) => {
  console.error('\nFalha ao limpar vínculos órfãos de cliente.');
  console.error(error);
  process.exitCode = 1;
});
