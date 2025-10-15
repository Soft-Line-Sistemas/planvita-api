"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const prisma_1 = require("../utils/prisma");
class UserService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async getAll() {
        return this.prisma.user.findMany({
            include: {
                roles: {
                    select: {
                        role: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });
    }
    async getById(id) {
        return this.prisma.user.findUnique({
            where: { id },
            include: {
                roles: {
                    select: {
                        role: {
                            select: { id: true, name: true },
                        },
                    },
                },
            },
        });
    }
    async create(data) {
        return this.prisma.user.create({ data });
    }
    async update(id, data) {
        return this.prisma.user.update({ where: { id: Number(id) }, data });
    }
    async delete(id) {
        return this.prisma.user.delete({ where: { id: Number(id) } });
    }
    async updateUserRole(userId, roleId) {
        await this.prisma.userRole.deleteMany({ where: { userId } });
        const newRole = await this.prisma.userRole.create({
            data: {
                userId,
                roleId,
            },
            include: {
                role: true,
            },
        });
        return newRole;
    }
}
exports.UserService = UserService;
