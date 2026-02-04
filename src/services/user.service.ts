import { Prisma, getPrismaForTenant } from '../utils/prisma';
import bcrypt from 'bcryptjs';

type UserType = Prisma.UserGetPayload<{}>;

type UserTypeCreate = {
  nome: string;
  email: string;
  roleId?: number;
  valorComissaoIndicacao?: number;
  password?: string; // senha em texto puro
};

type User = {
  id: number;
  name: string;
  email: string;
  roleId?: number | null;
  consultorId?: number | null;
  valorComissaoIndicacao?: number | null;
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
    consultor: {
      select: {
        id: true;
        valorComissaoIndicacao: true;
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

  private normalizarValorComissao(valor?: number): number {
    if (valor == null || Number.isNaN(Number(valor))) return 0;
    return Math.max(0, Number(valor));
  }

  private isConsultorRole(roleName?: string | null): boolean {
    return String(roleName || '')
      .trim()
      .toLowerCase() === 'consultor';
  }

  private async garantirConsultorParaUsuario(
    userId: number,
    nome: string,
    valorComissaoIndicacao?: number,
  ) {
    const valor = this.normalizarValorComissao(valorComissaoIndicacao);
    return this.prisma.consultor.upsert({
      where: { userId },
      create: {
        nome,
        userId,
        valorComissaoIndicacao: valor,
      },
      update: {
        nome,
        valorComissaoIndicacao: valor,
      },
      select: {
        id: true,
        valorComissaoIndicacao: true,
      },
    });
  }

  private async carregarMapaComissaoPendente(vendedorIds: number[]): Promise<Map<number, number>> {
    if (!vendedorIds.length) return new Map();

    const resumo = await this.prisma.comissao.groupBy({
      by: ['vendedorId'],
      where: {
        vendedorId: { in: vendedorIds },
        statusPagamento: 'PENDENTE',
      },
      _sum: {
        valor: true,
      },
    });

    return new Map(resumo.map((item) => [item.vendedorId, item._sum.valor ?? 0]));
  }

  async getAll(): Promise<UserRoleType[]> {
    const usuarios = await this.prisma.user.findMany({
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
        consultor: {
          select: {
            id: true,
            valorComissaoIndicacao: true,
          },
        },
      },
    });

    const vendedorIds = usuarios
      .map((u) => u.consultor?.id)
      .filter((id): id is number => Number.isFinite(id));
    const pendentePorVendedor = await this.carregarMapaComissaoPendente(vendedorIds);

    return usuarios.map((usuario) => ({
      ...usuario,
      consultor: usuario.consultor
        ? {
            ...usuario.consultor,
            comissaoPendente: pendentePorVendedor.get(usuario.consultor.id) ?? 0,
          }
        : null,
    })) as UserRoleType[];
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
        consultor: {
          select: {
            id: true,
            valorComissaoIndicacao: true,
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
      const roleAssignment = await this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: data.roleId,
        },
        include: {
          role: {
            select: {
              name: true,
            },
          },
        },
      });

      if (this.isConsultorRole(roleAssignment.role?.name)) {
        const consultor = await this.garantirConsultorParaUsuario(
          user.id,
          data.nome,
          data.valorComissaoIndicacao,
        );

        return {
          id: user.id,
          name: user.nome,
          email: user.email,
          roleId: data.roleId,
          consultorId: consultor.id,
          valorComissaoIndicacao: consultor.valorComissaoIndicacao,
        };
      }
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

  async updateUserRole(userId: number, roleId: number, valorComissaoIndicacao?: number) {
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

    if (this.isConsultorRole(newRole.role?.name)) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { nome: true },
      });

      if (user) {
        await this.garantirConsultorParaUsuario(userId, user.nome, valorComissaoIndicacao);
      }
    }

    return newRole;
  }
}
