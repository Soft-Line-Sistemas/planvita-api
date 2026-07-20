import { Prisma, getPrismaForTenant } from '../utils/prisma';
import bcrypt from 'bcryptjs';
import { ensureConsultorCode } from '../utils/consultor-code';

const FILES_API_BASE_URL = process.env.FILES_API_URL;

type UserType = Prisma.UserGetPayload<{}>;

type UserTypeCreate = {
  nome: string;
  email: string;
  roleId?: number;
  whatsapp?: string;
  valorComissaoIndicacao?: number;
  percentualComissaoIndicacao?: number;
  password?: string; // senha em texto puro
};

type User = {
  id: number;
  name: string;
  email: string;
  roleId?: number | null;
  consultorId?: number | null;
  consultorCodigo?: string | null;
  consultorWhatsapp?: string | null;
  valorComissaoIndicacao?: number | null;
  percentualComissaoIndicacao?: number | null;
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
        codigo: true;
        whatsapp: true;
        valorComissaoIndicacao: true;
        percentualComissaoIndicacao: true;
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

  private normalizarPercentualComissao(percentual?: number): number {
    if (percentual == null || Number.isNaN(Number(percentual))) return 0;
    return Math.max(0, Number(percentual));
  }

  private isConsultorRole(roleName?: string | null): boolean {
    return String(roleName || '')
      .trim()
      .toLowerCase() === 'consultor';
  }

  private async garantirConsultorParaUsuario(
    userId: number,
    nome: string,
    whatsapp?: string,
    valorComissaoIndicacao?: number,
    percentualComissaoIndicacao?: number,
  ) {
    const valor = this.normalizarValorComissao(valorComissaoIndicacao);
    const percentual = this.normalizarPercentualComissao(percentualComissaoIndicacao);
    const whatsappNormalizado = String(whatsapp ?? '').trim() || null;
    return this.prisma.consultor.upsert({
      where: { userId },
      create: {
        nome,
        userId,
        whatsapp: whatsappNormalizado,
        valorComissaoIndicacao: valor,
        percentualComissaoIndicacao: percentual,
      },
      update: {
        nome,
        whatsapp: whatsappNormalizado,
        valorComissaoIndicacao: valor,
        percentualComissaoIndicacao: percentual,
      },
      select: {
        id: true,
        codigo: true,
        whatsapp: true,
        valorComissaoIndicacao: true,
        percentualComissaoIndicacao: true,
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
            codigo: true,
            whatsapp: true,
            valorComissaoIndicacao: true,
            percentualComissaoIndicacao: true,
          },
        },
      },
    });

    await Promise.all(
      usuarios
        .map((usuario) => usuario.consultor)
        .filter((consultor): consultor is NonNullable<typeof consultor> => Boolean(consultor))
        .map((consultor) => ensureConsultorCode(this.tenantId, consultor)),
    );

    const refreshedUsers = await this.prisma.user.findMany({
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
            codigo: true,
            whatsapp: true,
            valorComissaoIndicacao: true,
            percentualComissaoIndicacao: true,
          },
        },
      },
    });

    const vendedorIds = refreshedUsers
      .map((u) => u.consultor?.id)
      .filter((id): id is number => Number.isFinite(id));
    const pendentePorVendedor = await this.carregarMapaComissaoPendente(vendedorIds);

    return refreshedUsers.map((usuario) => ({
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
    const usuario = await this.prisma.user.findUnique({
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
            codigo: true,
            whatsapp: true,
            valorComissaoIndicacao: true,
            percentualComissaoIndicacao: true,
          },
        },
      },
    });

    if (usuario?.consultor) {
      await ensureConsultorCode(this.tenantId, usuario.consultor);
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
              codigo: true,
              whatsapp: true,
              valorComissaoIndicacao: true,
              percentualComissaoIndicacao: true,
            },
          },
        },
      });
    }

    return usuario;
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
          data.whatsapp,
          data.valorComissaoIndicacao,
          data.percentualComissaoIndicacao,
        );

        return {
          id: user.id,
          name: user.nome,
          email: user.email,
          roleId: data.roleId,
          consultorId: consultor.id,
          consultorCodigo: await ensureConsultorCode(this.tenantId, consultor),
          consultorWhatsapp: consultor.whatsapp,
          valorComissaoIndicacao: consultor.valorComissaoIndicacao,
          percentualComissaoIndicacao: consultor.percentualComissaoIndicacao,
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
    const userId = Number(id);
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) {
      const err: any = new Error('Usuário não encontrado');
      err.status = 404;
      throw err;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { email },
    });
  }

  async updatePassword(id: number, newPassword: string): Promise<void> {
    const userId = Number(id);
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) {
      const err: any = new Error('Usuário não encontrado');
      err.status = 404;
      throw err;
    }

    const senhaHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { senhaHash },
    });
  }

  private getFilesApiToken(): string | null {
    if (!this.tenantId) return process.env.FILES_API_TOKEN || null;
    const normalized = this.tenantId.toUpperCase();
    const envKey = `FILES_API_TOKEN_${normalized}`;
    return process.env[envKey] || process.env.FILES_API_TOKEN || null;
  }

  private async uploadAvatarArquivo(buffer: Buffer, mimetype: string, filename: string) {
    const token = this.getFilesApiToken();
    if (!token) {
      throw new Error('Token da Files API não configurado para este tenant.');
    }

    const formData = new FormData();
    const uint = new Uint8Array(buffer);
    const blob = new Blob([uint], { type: mimetype });
    formData.append('file', blob, filename);

    const response = await fetch(`${FILES_API_BASE_URL}/file/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Falha ao enviar foto para armazenamento externo: ${response.status} ${message}`);
    }

    const payload = await response.json();
    const arquivoId = payload.id;
    const arquivoUrl = payload.path || `${FILES_API_BASE_URL}/file/${arquivoId}/download`;

    return { arquivoUrl };
  }

  private parseBase64Avatar(input: string, allowedMimeTypes: readonly string[], maxBytes: number, fallbackMimeType?: string) {
    const trimmed = (input || '').trim();
    if (!trimmed) {
      throw Object.assign(new Error('Formato de imagem inválido.'), { status: 400 });
    }

    const matches = trimmed.match(/^data:(.+);base64,(.+)$/);
    const mimetype = matches?.[1] ?? fallbackMimeType ?? 'image/png';
    const rawPayload = matches?.[2] ?? trimmed;
    const payload = rawPayload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');

    if (!allowedMimeTypes.includes(mimetype)) {
      throw Object.assign(new Error('Tipo de arquivo de imagem não permitido.'), { status: 400 });
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(payload)) {
      throw Object.assign(new Error('Imagem em base64 inválida.'), { status: 400 });
    }

    const buffer = Buffer.from(payload, 'base64');
    if (!buffer.length) {
      throw Object.assign(new Error('Imagem em base64 inválida.'), { status: 400 });
    }
    if (buffer.length > maxBytes) {
      throw Object.assign(new Error('Arquivo de imagem excede o limite permitido.'), { status: 400 });
    }

    return { buffer, mimetype };
  }

  private normalizeAvatarFilename(filenameRaw: string | undefined, mimeType: string, fallbackBaseName: string): string {
    const extensionByMime: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    };
    const extension = extensionByMime[mimeType] ?? 'bin';
    const sanitizedBase = String(filenameRaw ?? '')
      .trim()
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!sanitizedBase) {
      return `${fallbackBaseName}-${Date.now()}.${extension}`;
    }
    if (sanitizedBase.toLowerCase().endsWith(`.${extension}`)) {
      return sanitizedBase;
    }
    if (/\.[a-z0-9]+$/i.test(sanitizedBase)) {
      return sanitizedBase;
    }
    return `${sanitizedBase}.${extension}`;
  }

  async updateAvatar(
    id: number,
    fileBase64: string,
    filename: string,
    mimeType: string,
  ): Promise<UserType> {
    const userId = Number(id);
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) {
      const err: any = new Error('Usuário não encontrado');
      err.status = 404;
      throw err;
    }

    const { buffer, mimetype } = this.parseBase64Avatar(
      fileBase64,
      ['image/png', 'image/jpeg', 'image/webp'],
      5 * 1024 * 1024,
      mimeType,
    );
    const safeFilename = this.normalizeAvatarFilename(filename, mimetype, 'avatar');
    const { arquivoUrl } = await this.uploadAvatarArquivo(buffer, mimetype, safeFilename);

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: arquivoUrl },
    });
  }

  async removeAvatar(id: number): Promise<UserType> {
    const userId = Number(id);
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!existing) {
      const err: any = new Error('Usuário não encontrado');
      err.status = 404;
      throw err;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
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

  async updateUserRole(
    userId: number,
    roleId: number,
    whatsapp?: string,
    valorComissaoIndicacao?: number,
    percentualComissaoIndicacao?: number,
  ) {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, nome: true },
      }),
      this.prisma.role.findUnique({
        where: { id: roleId },
        select: { id: true },
      }),
    ]);

    if (!user) {
      const err: any = new Error('Usuário não encontrado');
      err.status = 404;
      throw err;
    }
    if (!role) {
      const err: any = new Error('Role não encontrada');
      err.status = 404;
      throw err;
    }

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

    let consultorPayload:
      | {
          id: number;
          codigo: string;
          whatsapp: string | null;
          valorComissaoIndicacao: number;
          percentualComissaoIndicacao: number;
        }
      | null = null;

    if (this.isConsultorRole(newRole.role?.name)) {
      const consultor = await this.garantirConsultorParaUsuario(
        userId,
        user.nome,
        whatsapp,
        valorComissaoIndicacao,
        percentualComissaoIndicacao,
      );
      consultorPayload = {
        id: consultor.id,
        codigo: await ensureConsultorCode(this.tenantId, consultor),
        whatsapp: consultor.whatsapp,
        valorComissaoIndicacao: consultor.valorComissaoIndicacao,
        percentualComissaoIndicacao: consultor.percentualComissaoIndicacao,
      };
    }

    return {
      userId,
      roleId,
      consultor: consultorPayload,
    };
  }
}
