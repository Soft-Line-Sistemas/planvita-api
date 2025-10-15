import { getPrismaForTenant } from '../utils/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserPayload } from '../types/auth';
import config from '../config';

export class AuthService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async validateUser(email: string, senha: string): Promise<UserPayload | null> {
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

    if (!user) return null;

    const isValid = await bcrypt.compare(senha, user.senhaHash);
    if (!isValid) return null;

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

  generateToken(user: UserPayload) {
    return jwt.sign(user, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
  }
}
