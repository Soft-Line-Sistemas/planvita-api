"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagamentoService = void 0;
const prisma_1 = require("../utils/prisma");
class PagamentoService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.pagamento.findMany();
    }
    async getById(id) {
        return this.prisma.pagamento.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.pagamento.create({ data });
    }
    async update(id, data) {
        return this.prisma.pagamento.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.pagamento.delete({ where: { id: Number(id) } });
    }
}
exports.PagamentoService = PagamentoService;
