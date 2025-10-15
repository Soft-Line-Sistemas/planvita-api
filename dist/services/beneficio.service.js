"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeneficioService = void 0;
const prisma_1 = require("../utils/prisma");
class BeneficioService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.beneficio.findMany();
    }
    async getById(id) {
        return this.prisma.beneficio.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.beneficio.create({ data });
    }
    async update(id, data) {
        return this.prisma.beneficio.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.beneficio.delete({ where: { id: Number(id) } });
    }
}
exports.BeneficioService = BeneficioService;
