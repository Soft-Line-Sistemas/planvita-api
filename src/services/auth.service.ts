import prisma from '../utils/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserPayload } from '../types/auth';
import config from '../config';

export class AuthService {
  async validateUser(email: string, senha: string, tenant: string): Promise<UserPayload | null> {
    const user = await prisma.user.findUnique({
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
      tenant: tenant,
    };
  }

  generateToken(user: UserPayload) {
    return jwt.sign(user, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
  }
}
