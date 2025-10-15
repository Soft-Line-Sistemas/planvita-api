"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CorresponsavelService = void 0;
const prisma_1 = require("../utils/prisma");
class CorresponsavelService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.corresponsavel.findMany();
    }
    async getById(id) {
        return this.prisma.corresponsavel.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.corresponsavel.create({ data });
    }
    async update(id, data) {
        return this.prisma.corresponsavel.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.corresponsavel.delete({ where: { id: Number(id) } });
    }
}
exports.CorresponsavelService = CorresponsavelService;
