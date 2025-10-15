"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionService = void 0;
const prisma_1 = require("../utils/prisma");
class PermissionService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.permission.findMany();
    }
    async getById(id) {
        return this.prisma.permission.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.permission.create({ data });
    }
    async update(id, data) {
        return this.prisma.permission.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.permission.delete({ where: { id: Number(id) } });
    }
}
exports.PermissionService = PermissionService;
