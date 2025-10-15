"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeyService = void 0;
const prisma_1 = require("../utils/prisma");
class ApiKeyService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.apiKey.findMany();
    }
    async getById(id) {
        return this.prisma.apiKey.findUnique({ where: { id: String(id) } });
    }
    async create(data) {
        return this.prisma.apiKey.create({ data });
    }
    async update(id, data) {
        return this.prisma.apiKey.update({ where: { id: String(id) }, data });
    }
    async delete(id) {
        return this.prisma.apiKey.delete({ where: { id: String(id) } });
    }
}
exports.ApiKeyService = ApiKeyService;
