"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("../../generated/prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
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
        console.log('Role admin_master criada!');
    }
    else {
        console.log('Role admin_master já existe!');
    }
    const senha = '123456';
    const senhaHash = await bcryptjs_1.default.hash(senha, 10);
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
        console.log('Usuário Soft Line criado!');
    }
    else {
        console.log('Usuário Soft Line já existe!');
    }
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
        console.log('Vinculado Soft Line à role admin_master!');
    }
    else {
        console.log('Soft Line já está vinculado à role admin_master!');
    }
    const todasPermissoes = await prisma.permission.findMany();
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
            console.log(`Permissão ${perm.name} atribuída a admin_master`);
        }
    }
    console.log('Seeder concluída!');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
