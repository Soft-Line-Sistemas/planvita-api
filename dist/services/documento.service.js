"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentoService = void 0;
const prisma_1 = require("../utils/prisma");
class DocumentoService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.documento.findMany();
    }
    async getById(id) {
        return this.prisma.documento.findUnique({ where: { id: Number(id) } });
    }
    async create(data) {
        return this.prisma.documento.create({ data });
    }
    async update(id, data) {
        return this.prisma.documento.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.documento.delete({ where: { id: Number(id) } });
    }
}
exports.DocumentoService = DocumentoService;
