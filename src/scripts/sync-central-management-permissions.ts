import { getPrismaForTenant } from '../utils/prisma';

const CENTRAL_MANAGEMENT_PERMISSIONS = [
  'plano.view',
  'plano.create',
  'plano.update',
  'plano.delete',
  'parcerias.view',
  'parcerias.create',
  'parcerias.update',
  'parcerias.delete',
  'finance.view',
  'role.view',
  'role.create',
  'role.update',
  'role.delete',
  'permission.view',
  'layout.view',
  'layout.update',
  'regras.view',
  'regras.update',
] as const;

const RULES_PERMISSIONS = [
  {
    name: 'regras.view',
    description: 'Visualizar regras de negócio',
  },
  {
    name: 'regras.update',
    description: 'Criar e atualizar regras de negócio',
  },
] as const;

async function ensureRulesPermissionsForBosque() {
  const tenantId = 'bosque';
  const prisma = getPrismaForTenant(tenantId);

  for (const permission of RULES_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: { description: permission.description },
      create: permission,
    });
  }

  return prisma;
}

async function main() {
  const bosque = await ensureRulesPermissionsForBosque();
  const adminMaster = await bosque.role.findUnique({
    where: { name: 'admin_master' },
  });
  const regras = await bosque.permission.findMany({
    where: { name: { in: RULES_PERMISSIONS.map((permission) => permission.name) } },
  });

  if (!adminMaster) {
    throw new Error('Role admin_master não encontrada no tenant Bosque.');
  }

  for (const permission of regras) {
    await bosque.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminMaster.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: { roleId: adminMaster.id, permissionId: permission.id },
    });
  }

  for (const tenantId of ['lider', 'pax']) {
    const prisma = getPrismaForTenant(tenantId);
    const permissions = await prisma.permission.findMany({
      where: { name: { in: CENTRAL_MANAGEMENT_PERMISSIONS as unknown as string[] } },
      select: { id: true },
    });
    await prisma.rolePermission.deleteMany({
      where: { permissionId: { in: permissions.map((permission) => permission.id) } },
    });
    await prisma.permission.deleteMany({
      where: { id: { in: permissions.map((permission) => permission.id) } },
    });
  }

  console.log('Permissões centralizadas sincronizadas com sucesso.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(['bosque', 'lider', 'pax'].map((tenantId) => getPrismaForTenant(tenantId).$disconnect()));
  });
