"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DependenteService = void 0;
const prisma_1 = require("../utils/prisma");
class DependenteService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.dependente.findMany();
    }
    async getById(id) {
        return this.prisma.dependente.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.dependente.create({ data });
    }
    async update(id, data) {
        return this.prisma.dependente.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.dependente.delete({ where: { id: Number(id) } });
    }
}
exports.DependenteService = DependenteService;
