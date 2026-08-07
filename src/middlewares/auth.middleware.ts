import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, UserPayload } from '../types/auth';
import { getPrismaForTenant } from '../utils/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ message: 'Não autenticado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserPayload;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido' });
  }
}

export function authorize(requiredPermissions: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const tenantId = req.user?.tenant;
    const userId = req.user?.id;

    if (!tenantId || !userId) {
      return res.status(401).json({ message: 'Não autenticado' });
    }

    try {
      // As permissões do JWT podem ter sido revogadas após o login. Consulte a
      // base do tenant para que bloqueios administrativos tenham efeito imediato.
      const prisma = getPrismaForTenant(tenantId);
      const roles = await prisma.userRole.findMany({
        where: { userId },
        select: {
          role: {
            select: {
              RolePermission: {
                select: { permission: { select: { name: true } } },
              },
            },
          },
        },
      });
      const userPermissions = roles.flatMap((userRole) =>
        userRole.role.RolePermission.map((rolePermission) => rolePermission.permission.name),
      );

      const hasPermission = requiredPermissions.every((p) => userPermissions.includes(p));

      if (!hasPermission) {
        return res.status(403).json({ message: 'Permissão insuficiente' });
      }

      next();
    } catch {
      return res.status(500).json({ message: 'Não foi possível validar permissões' });
    }
  };
}
