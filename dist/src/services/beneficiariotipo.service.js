"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeneficiarioTipoService = void 0;
const prisma_1 = require("../utils/prisma");
class BeneficiarioTipoService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.beneficiarioTipo.findMany();
    }
    async getById(id) {
        return this.prisma.beneficiarioTipo.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.beneficiarioTipo.create({ data });
    }
    async update(id, data) {
        return this.prisma.beneficiarioTipo.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.beneficiarioTipo.delete({ where: { id: Number(id) } });
    }
}
exports.BeneficiarioTipoService = BeneficiarioTipoService;
