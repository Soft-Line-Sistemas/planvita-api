import { PrismaClient } from '../../generated/prisma/client/index.js'; // Ajuste o caminho se necessário
import bcrypt from 'bcryptjs';

// Inicialize o Prisma Client
const prisma = new PrismaClient();

/**
 * Função principal para criar a role 'admin_master', o usuário 'softline@admin.com'
 * e atribuir todas as permissões e a role ao usuário.
 */
async function main() {
  // 1. Criar ou Encontrar a Role 'admin_master'
  let adminRole = await prisma.role.findUnique({
    where: { name: 'admin_master' },
  });

  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: {
        name: 'admin_master',
        description: 'Administrador master com acesso total',
      },
    });
    console.log('✅ Role admin_master criada!');
  } else {
    console.log('ℹ️ Role admin_master já existe!');
  }

  // 2. Criar ou Encontrar o Usuário 'softline@admin.com'
  const senha = '123456';
  // O bcrypt importado via ESM (import bcrypt from 'bcryptjs') é o objeto padrão,
  // então a chamada é direta.
  const senhaHash = await bcrypt.hash(senha, 10);

  let softline = await prisma.user.findUnique({
    where: { email: 'softline@admin.com' },
  });

  if (!softline) {
    softline = await prisma.user.create({
      data: {
        nome: 'Soft Line',
        email: 'softline@admin.com',
        senhaHash,
        ativo: true,
      },
    });
    console.log('✅ Usuário Soft Line criado!');
  } else {
    console.log('ℹ️ Usuário Soft Line já existe!');
  }

  // 3. Vincular o Usuário à Role 'admin_master'
  const existingUserRole = await prisma.userRole.findUnique({
    where: {
      userId_roleId: {
        userId: softline.id,
        roleId: adminRole.id,
      },
    },
  });

  if (!existingUserRole) {
    await prisma.userRole.create({
      data: {
        userId: softline.id,
        roleId: adminRole.id,
      },
    });
    console.log('✅ Vinculado Soft Line à role admin_master!');
  } else {
    console.log('ℹ️ Soft Line já está vinculado à role admin_master!');
  }

  // 4. Atribuir TODAS as permissões à Role 'admin_master'
  const todasPermissoes = await prisma.permission.findMany();
  let novasPermissoesAtribuidas = 0;

  for (const perm of todasPermissoes) {
    const existing = await prisma.rolePermission.findUnique({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: perm.id,
        },
      },
    });

    if (!existing) {
      await prisma.rolePermission.create({
        data: {
          roleId: adminRole.id,
          permissionId: perm.id,
        },
      });
      novasPermissoesAtribuidas++;
    }
  }

  if (novasPermissoesAtribuidas > 0) {
    console.log(`✅ ${novasPermissoesAtribuidas} permissões atribuídas a admin_master.`);
  } else {
    console.log('ℹ️ Nenhuma nova permissão precisou ser atribuída.');
  }

  console.log('\n✨ **Seeder concluída com sucesso!** ✨');
}

// Execução da função principal
main()
  .catch((e) => {
    console.error('❌ Erro durante o seeder:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
