import prisma, { Prisma } from '../utils/prisma';

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
  async getAll(): Promise<UserRoleType[]> {
    return prisma.user.findMany({
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
    return prisma.user.findUnique({
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
    return prisma.user.create({ data });
  }

  async update(id: number, data: Partial<UserType>): Promise<UserType> {
    return prisma.user.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<UserType> {
    return prisma.user.delete({ where: { id: Number(id) } });
  }

  async updateUserRole(userId: number, roleId: number) {
    await prisma.userRole.deleteMany({ where: { userId } });

    const newRole = await prisma.userRole.create({
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
