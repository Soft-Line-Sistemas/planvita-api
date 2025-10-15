"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoleService = void 0;
const prisma_1 = require("../utils/prisma");
class RoleService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.role.findMany({
            include: {
                RolePermission: {
                    select: { permissionId: true },
                },
            },
        });
    }
    async getById(id) {
        return this.prisma.role.findUnique({
            where: { id },
            include: {
                RolePermission: {
                    select: { permissionId: true },
                },
            },
        });
    }
    async create(data) {
        return this.prisma.role.create({ data });
    }
    async update(id, data) {
        return this.prisma.role.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.role.delete({ where: { id: Number(id) } });
    }
    async updatePermissions(roleId, permissionIds) {
        await this.prisma.rolePermission.deleteMany({ where: { roleId } });
        const newPermissions = permissionIds.map((pid) => ({
            roleId,
            permissionId: pid,
        }));
        await this.prisma.rolePermission.createMany({ data: newPermissions });
        return {
            roleId,
            updatedPermissions: permissionIds,
        };
    }
}
exports.RoleService = RoleService;
