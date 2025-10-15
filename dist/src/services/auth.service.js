"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const prisma_1 = require("../utils/prisma");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = __importDefault(require("../config"));
class AuthService {
    constructor(tenantId) {
        this.tenantId = tenantId;
        if (!tenantId) {
            throw new Error('Tenant ID must be provided');
        }
        this.prisma = (0, prisma_1.getPrismaForTenant)(tenantId);
    }
    async validateUser(email, senha) {
        const user = await this.prisma.user.findUnique({
            where: { email },
            include: {
                roles: {
                    select: {
                        role: {
                            select: {
                                id: true,
                                name: true,
                                RolePermission: {
                                    select: {
                                        permission: { select: { name: true } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!user)
            return null;
        const isValid = await bcryptjs_1.default.compare(senha, user.senhaHash);
        if (!isValid)
            return null;
        const roleData = user.roles?.[0]?.role || null;
        const permissions = roleData ? roleData.RolePermission.map((rp) => rp.permission.name) : [];
        const role = roleData ? { id: roleData.id, name: roleData.name } : null;
        return {
            id: user.id,
            nome: user.nome,
            email: user.email,
            role,
            permissions,
            tenant: this.tenantId,
        };
    }
    generateToken(user) {
        return jsonwebtoken_1.default.sign(user, config_1.default.jwt.secret, { expiresIn: config_1.default.jwt.expiresIn });
    }
}
exports.AuthService = AuthService;
