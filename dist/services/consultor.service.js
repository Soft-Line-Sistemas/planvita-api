"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsultorService = void 0;
const prisma_1 = require("../utils/prisma");
class ConsultorService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.consultor.findMany();
    }
    async getById(id) {
        return this.prisma.consultor.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.consultor.create({ data });
    }
    async update(id, data) {
        return this.prisma.consultor.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.consultor.delete({ where: { id: Number(id) } });
    }
}
exports.ConsultorService = ConsultorService;
