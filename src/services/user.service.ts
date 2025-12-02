import { Prisma, getPrismaForTenant } from '../utils/prisma';
import bcrypt from 'bcryptjs';

type UserType = Prisma.UserGetPayload<{}>;

type UserTypeCreate = {
  nome: string;
  email: string;
  roleId?: number;
  password?: string; // senha em texto puro
};

type User = {
  id: number;
  name: string;
  email: string;
  roleId?: number | null;
};

type UserRoleType = Prisma.UserGetPayload<{
  include: {
    roles: {
      select: {
        role: {
          select: {
            id: true;
            name: true;
          };
        };
      };
    };
  };
}>;

export class UserService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<UserRoleType[]> {
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

  async getById(id: number): Promise<UserRoleType | null> {
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

  async create(data: UserTypeCreate): Promise<User> {
    const plainPassword = '123456';
    const senhaHash = await bcrypt.hash(plainPassword, 10);

    const user = await this.prisma.user.create({
      data: {
        nome: data.nome,
        email: data.email,
        senhaHash,
      },
    });

    if (data.roleId) {
      await this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: data.roleId,
        },
      });
    }

    return {
      id: user.id,
      name: user.nome,
      email: user.email,
      roleId: data.roleId,
    };
  }

  async update(id: number, data: Partial<UserType>): Promise<UserType> {
    return this.prisma.user.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<UserType> {
    return this.prisma.user.delete({ where: { id: Number(id) } });
  }

  async updateEmail(id: number, email: string): Promise<UserType> {
    return this.prisma.user.update({
      where: { id: Number(id) },
      data: { email },
    });
  }

  async updatePassword(id: number, newPassword: string): Promise<void> {
    const senhaHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: Number(id) },
      data: { senhaHash },
    });
  }

  async verifyPassword(id: number, plainPassword: string): Promise<boolean | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: Number(id) },
      select: { senhaHash: true },
    });

    if (!user) return null;

    return bcrypt.compare(plainPassword, user.senhaHash);
  }

  async updateUserRole(userId: number, roleId: number) {
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
