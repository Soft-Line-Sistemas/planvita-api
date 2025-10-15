import { Prisma, getPrismaForTenant } from '../utils/prisma';

type UserType = Prisma.UserGetPayload<{}>;

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

  async create(data: UserType): Promise<UserType> {
    return this.prisma.user.create({ data });
  }

  async update(id: number, data: Partial<UserType>): Promise<UserType> {
    return this.prisma.user.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<UserType> {
    return this.prisma.user.delete({ where: { id: Number(id) } });
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
