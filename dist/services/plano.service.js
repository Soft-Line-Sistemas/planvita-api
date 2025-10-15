"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanoService = void 0;
const prisma_1 = require("../utils/prisma");
class PlanoService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.plano.findMany();
    }
    async getById(id) {
        return this.prisma.plano.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.plano.create({ data });
    }
    async update(id, data) {
        return this.prisma.plano.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.plano.delete({ where: { id: Number(id) } });
    }
}
exports.PlanoService = PlanoService;
