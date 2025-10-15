"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitularService = void 0;
const prisma_1 = require("../utils/prisma");
class TitularService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.titular.findMany();
    }
    async getById(id) {
        return this.prisma.titular.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.titular.create({ data });
    }
    async update(id, data) {
        return this.prisma.titular.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.titular.delete({ where: { id: Number(id) } });
    }
}
exports.TitularService = TitularService;
