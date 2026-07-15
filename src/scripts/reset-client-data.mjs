import { PrismaClient } from '@prisma/client';

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

function buildInClause(ids) {
  return ids.join(',');
}

async function countOptionalByTitularIds(prisma, tableName, titularIds) {
  if (titularIds.length === 0) return 0;
  if (!(await tableExists(prisma, tableName))) return 0;

  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(1) AS total FROM ${tableName} WHERE titularId IN (${buildInClause(titularIds)})`,
  );

  return Number(rows[0]?.total ?? 0);
}

async function deleteOptionalByTitularIds(prisma, tableName, titularIds) {
  if (titularIds.length === 0) return { count: 0 };
  if (!(await tableExists(prisma, tableName))) return { count: 0 };

  const count = await prisma.$executeRawUnsafe(
    `DELETE FROM ${tableName} WHERE titularId IN (${buildInClause(titularIds)})`,
  );

  return { count: Number(count ?? 0) };
}

async function safeCount(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error?.code === 'P2021') return 0;
    throw error;
  }
}

async function safeDeleteMany(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error?.code === 'P2021') return { count: 0 };
    throw error;
  }
}

async function collectIds(prisma) {
  const titulares = await prisma.titular.findMany({
    select: { id: true },
  });

  const titularIds = titulares.map((item) => item.id);
  if (titularIds.length === 0) {
    return {
      titularIds,
      contaReceberIds: [],
      contaPagarIds: [],
    };
  }

  const [contasReceber, comissoes] = await Promise.all([
    prisma.contaReceber.findMany({
      where: { clienteId: { in: titularIds } },
      select: { id: true },
    }),
    prisma.comissao.findMany({
      where: { titularId: { in: titularIds } },
      select: { contaPagarId: true },
    }),
  ]);

  return {
    titularIds,
    contaReceberIds: contasReceber.map((item) => item.id),
    contaPagarIds: comissoes
      .map((item) => item.contaPagarId)
      .filter((value) => typeof value === 'number'),
  };
}

async function collectCounts(prisma, ids) {
  const { titularIds, contaReceberIds, contaPagarIds } = ids;

  if (titularIds.length === 0) {
    return {
      titulares: 0,
      dependentes: 0,
      corresponsaveis: 0,
      pagamentos: 0,
      contasReceber: 0,
      comissoes: 0,
      contasPagar: 0,
      documentos: 0,
      assinaturas: 0,
      credenciais: 0,
      otps: 0,
      tokens: 0,
      consentimentos: 0,
      alteracoesPagamento: 0,
      orcamentos: 0,
      recibos: 0,
      resgatesParceria: 0,
      notificationLogs: 0,
      whatsappDispatchesTitular: 0,
      whatsappDispatchesConta: 0,
      financialAuditsContaReceber: 0,
    };
  }

  const [
    dependentes,
    corresponsaveis,
    pagamentos,
    contasReceber,
    comissoes,
    contasPagar,
    documentos,
    assinaturas,
    credenciais,
    otps,
    tokens,
    consentimentos,
    alteracoesPagamento,
    orcamentos,
    recibos,
    resgatesParceria,
    notificationLogs,
    whatsappDispatchesTitular,
    whatsappDispatchesConta,
    financialAuditsContaReceber,
  ] = await Promise.all([
    prisma.dependente.count({ where: { titularId: { in: titularIds } } }),
    prisma.corresponsavel.count({ where: { titularId: { in: titularIds } } }),
    prisma.pagamento.count({ where: { titularId: { in: titularIds } } }),
    prisma.contaReceber.count({ where: { clienteId: { in: titularIds } } }),
    prisma.comissao.count({ where: { titularId: { in: titularIds } } }),
    contaPagarIds.length > 0
      ? prisma.contaPagar.count({ where: { id: { in: contaPagarIds } } })
      : Promise.resolve(0),
    prisma.documento.count({ where: { titularId: { in: titularIds } } }),
    prisma.assinaturaDigital.count({ where: { titularId: { in: titularIds } } }),
    prisma.titularCredential.count({ where: { titularId: { in: titularIds } } }),
    prisma.titularOtp.count({ where: { titularId: { in: titularIds } } }),
    prisma.titularToken.count({ where: { titularId: { in: titularIds } } }),
    countOptionalByTitularIds(prisma, 'consent_acceptances', titularIds),
    safeCount(() => prisma.paymentMethodChangeRequest.count({ where: { titularId: { in: titularIds } } })),
    prisma.orcamento.count({ where: { clienteId: { in: titularIds } } }),
    prisma.recibo.count({ where: { clienteId: { in: titularIds } } }),
    prisma.parceriaVantagemResgate.count({ where: { titularId: { in: titularIds } } }),
    safeCount(() => prisma.notificationLog.count({ where: { titularId: { in: titularIds } } })),
    safeCount(() => prisma.whatsappAutomationDispatch.count({ where: { titularId: { in: titularIds } } })),
    contaReceberIds.length > 0
      ? safeCount(() => prisma.whatsappAutomationDispatch.count({ where: { contaReceberId: { in: contaReceberIds } } }))
      : Promise.resolve(0),
    contaReceberIds.length > 0
      ? safeCount(() => prisma.financialAudit.count({
          where: {
            entityType: 'ContaReceber',
            entityId: { in: contaReceberIds },
          },
        }))
      : Promise.resolve(0),
  ]);

  return {
    titulares: titularIds.length,
    dependentes,
    corresponsaveis,
    pagamentos,
    contasReceber,
    comissoes,
    contasPagar,
    documentos,
    assinaturas,
    credenciais,
    otps,
    tokens,
    consentimentos,
    alteracoesPagamento,
    orcamentos,
    recibos,
    resgatesParceria,
    notificationLogs,
    whatsappDispatchesTitular,
    whatsappDispatchesConta,
    financialAuditsContaReceber,
  };
}

async function deleteClientData(prisma, ids) {
  const { titularIds, contaReceberIds, contaPagarIds } = ids;

  if (titularIds.length === 0) {
    return {};
  }

  return prisma.$transaction(async (tx) => {
    const result = {};

    result.notificationLogs = await safeDeleteMany(() => tx.notificationLog.deleteMany({
      where: { titularId: { in: titularIds } },
    }));

    result.whatsappDispatchesTitular = await safeDeleteMany(() => tx.whatsappAutomationDispatch.deleteMany({
      where: { titularId: { in: titularIds } },
    }));

    if (contaReceberIds.length > 0) {
      result.whatsappDispatchesConta = await safeDeleteMany(() => tx.whatsappAutomationDispatch.deleteMany({
        where: { contaReceberId: { in: contaReceberIds } },
      }));

      result.financialAuditsContaReceber = await safeDeleteMany(() => tx.financialAudit.deleteMany({
        where: {
          entityType: 'ContaReceber',
          entityId: { in: contaReceberIds },
        },
      }));
    }

    result.alteracoesPagamento = await safeDeleteMany(() => tx.paymentMethodChangeRequest.deleteMany({
      where: { titularId: { in: titularIds } },
    }));

    result.consentimentos = await deleteOptionalByTitularIds(tx, 'consent_acceptances', titularIds);

    result.credenciais = await tx.titularCredential.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    result.otps = await tx.titularOtp.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    result.tokens = await tx.titularToken.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    result.assinaturas = await tx.assinaturaDigital.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    result.documentos = await tx.documento.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    result.resgatesParceria = await tx.parceriaVantagemResgate.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    result.dependentes = await tx.dependente.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    result.corresponsaveis = await tx.corresponsavel.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    result.pagamentos = await tx.pagamento.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    result.comissoes = await tx.comissao.deleteMany({
      where: { titularId: { in: titularIds } },
    });

    if (contaPagarIds.length > 0) {
      result.contasPagar = await tx.contaPagar.deleteMany({
        where: { id: { in: contaPagarIds } },
      });
    }

    result.contasReceber = await tx.contaReceber.deleteMany({
      where: { clienteId: { in: titularIds } },
    });

    result.orcamentos = await tx.orcamento.deleteMany({
      where: { clienteId: { in: titularIds } },
    });

    result.recibos = await tx.recibo.deleteMany({
      where: { clienteId: { in: titularIds } },
    });

    result.titulares = await tx.titular.deleteMany({
      where: { id: { in: titularIds } },
    });

    return result;
  });
}

function logCounts(label, counts) {
  console.log(`\n[${label}]`);
  Object.entries(counts).forEach(([key, value]) => {
    console.log(`- ${key}: ${value}`);
  });
}

async function processTenant(tenant, dryRun) {
  const url = process.env[tenant.envVar];
  if (!url) {
    throw new Error(`Variável ${tenant.envVar} não definida`);
  }

  const prisma = buildClient(url);

  try {
    const ids = await collectIds(prisma);
    const before = await collectCounts(prisma, ids);
    logCounts(`${tenant.id} antes`, before);

    if (dryRun || ids.titularIds.length === 0) {
      return;
    }

    await deleteClientData(prisma, ids);

    const afterIds = await collectIds(prisma);
    const after = await collectCounts(prisma, afterIds);
    logCounts(`${tenant.id} depois`, after);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const dryRun = !hasFlag('--execute');
  const tenantFilter = parseTenantFilter();
  const tenants = tenantFilter
    ? TENANTS.filter((tenant) => tenantFilter.includes(tenant.id))
    : TENANTS;

  if (tenants.length === 0) {
    throw new Error('Nenhum tenant válido informado');
  }

  console.log(dryRun ? 'Modo dry-run: nenhuma exclusão será executada.' : 'Executando reset de clientes.');

  for (const tenant of tenants) {
    await processTenant(tenant, dryRun);
  }
}

main().catch((error) => {
  console.error('\nFalha ao resetar dados de clientes.');
  console.error(error);
  process.exitCode = 1;
});
