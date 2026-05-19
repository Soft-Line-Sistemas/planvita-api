import { getPrismaForTenant } from '../utils/prisma';

const TENANTS = ['PAX', 'LIDER', 'BOSQUE'] as const;

async function main() {
  for (const tenant of TENANTS) {
    const prisma = getPrismaForTenant(tenant);
    const rows = await prisma.parceriaVantagem.findMany({
      select: { slug: true, titulo: true, status: true, publico: true, destaque: true, ordem: true },
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
    });
    console.log(`\n==> ${tenant} (${rows.length})`);
    for (const r of rows) {
      console.log(`- ${r.slug} | ${r.titulo} | ${r.status} | ${r.publico} | destaque=${r.destaque} | ordem=${r.ordem}`);
    }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
