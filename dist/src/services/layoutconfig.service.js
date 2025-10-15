"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LayoutConfigService = void 0;
const prisma_1 = require("../utils/prisma");
class LayoutConfigService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.layoutConfig.findMany();
    }
    async getById(id) {
        return this.prisma.layoutConfig.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.layoutConfig.create({ data });
    }
    async update(id, data) {
        return this.prisma.layoutConfig.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.layoutConfig.delete({ where: { id: Number(id) } });
    }
}
exports.LayoutConfigService = LayoutConfigService;
