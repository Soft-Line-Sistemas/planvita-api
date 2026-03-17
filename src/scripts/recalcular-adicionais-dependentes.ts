import { getPrismaForTenant } from '../utils/prisma';
import { TitularPricingService } from '../services/titular-pricing.service';

async function main() {
  const tenants = ['PAX', 'LIDER', 'BOSQUE'];

  for (const tenant of tenants) {
    const prisma = getPrismaForTenant(tenant);
    const pricingService = new TitularPricingService(tenant);

    const titulares = await prisma.titular.findMany({
      where: {
        dependentes: {
          some: {},
        },
      },
      select: {
        id: true,
      },
    });

    for (const titular of titulares) {
      await pricingService.recalcularDependentesDoTitular(titular.id);
    }

    console.log(
      `[${tenant}] titulares recalculados: ${titulares.length}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
