import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { getConfiguredPublicTenants, getTenantLabel } from '../utils/tenants';
import { ensureConsultorCode, normalizeConsultorCode } from '../utils/consultor-code';

type ConsultorType = Prisma.ConsultorGetPayload<{}>;
type ConsultorPublicOptionType = Prisma.ConsultorGetPayload<{
  select: {
    id: true;
    codigo: true;
    nome: true;
    whatsapp: true;
    user: {
      select: {
        id: true;
        nome: true;
        email: true;
        avatarUrl: true;
      };
    };
  };
}>;
type ConsultorResumoType = Prisma.ConsultorGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        nome: true;
        email: true;
      };
    };
  };
}>;

export type ConsultorPublicOption = {
  id: number;
  codigo: string;
  nome: string;
  nomeCompleto: string;
  whatsapp: string | null;
  email: string | null;
  avatarUrl: string | null;
  userId: number | null;
  tenantId: string;
  tenantLabel: string;
  selectionKey: string;
};

function buildSelectionKey(tenantId: string, consultorId: number) {
  return `${tenantId}:${consultorId}`;
}

function formatConsultorDisplayName(nome: string, tenantId: string) {
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  const resumido =
    partes.length <= 1 ? (partes[0] ?? '') : `${partes[0]} ${partes[partes.length - 1]}`;
  return `${resumido} (${getTenantLabel(tenantId)})`.trim();
}

export class ConsultorService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(): Promise<ConsultorType[]> {
    const consultores = await this.prisma.consultor.findMany();
    await Promise.all(
      consultores.map((consultor) => ensureConsultorCode(this.tenantId, consultor)),
    );
    return this.prisma.consultor.findMany();
  }

  async getPublicOptions(): Promise<ConsultorPublicOption[]> {
    const options = (await this.prisma.consultor.findMany({
      select: {
        id: true,
        codigo: true,
        nome: true,
        whatsapp: true,
        user: {
          select: {
            id: true,
            nome: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: {
        nome: 'asc',
      },
    })) as ConsultorPublicOptionType[];

    return Promise.all(
      options.map(async (option) => ({
        id: option.id,
        codigo: await ensureConsultorCode(this.tenantId, option),
        nome: formatConsultorDisplayName(option.nome, this.tenantId),
        nomeCompleto: option.nome,
        whatsapp: option.whatsapp ?? null,
        email: option.user?.email ?? null,
        avatarUrl: option.user?.avatarUrl ?? null,
        userId: option.user?.id ?? null,
        tenantId: this.tenantId,
        tenantLabel: getTenantLabel(this.tenantId),
        selectionKey: buildSelectionKey(this.tenantId, option.id),
      })),
    );
  }

  static async getGlobalPublicOptions(nome = ''): Promise<ConsultorPublicOption[]> {
    const tenants = getConfiguredPublicTenants();
    const nomeBusca = String(nome).trim();
    const resultados = await Promise.all(
      tenants.map(async (tenantId) => {
        const prisma = getPrismaForTenant(tenantId);
        const consultores = (await prisma.consultor.findMany({
          where: nomeBusca
            ? {
                nome: {
                  contains: nomeBusca,
                },
              }
            : undefined,
          select: {
            id: true,
            codigo: true,
            nome: true,
            whatsapp: true,
            user: {
              select: {
                id: true,
                nome: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: {
            nome: 'asc',
          },
        })) as ConsultorPublicOptionType[];

        return Promise.all(
          consultores.map(async (consultor) => ({
            id: consultor.id,
            codigo: await ensureConsultorCode(tenantId, consultor),
            nome: formatConsultorDisplayName(consultor.nome, tenantId),
            nomeCompleto: consultor.nome,
            whatsapp: consultor.whatsapp ?? null,
            email: consultor.user?.email ?? null,
            avatarUrl: consultor.user?.avatarUrl ?? null,
            userId: consultor.user?.id ?? null,
            tenantId,
            tenantLabel: getTenantLabel(tenantId),
            selectionKey: buildSelectionKey(tenantId, consultor.id),
          })),
        );
      }),
    );

    return resultados
      .flat()
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }

  static async resolvePublicByCode(code: string): Promise<ConsultorPublicOption | null> {
    const normalizedCode = normalizeConsultorCode(code);
    if (!normalizedCode) return null;

    const tenants = getConfiguredPublicTenants();
    for (const tenantId of tenants) {
      const prisma = getPrismaForTenant(tenantId);
      const consultor = (await prisma.consultor.findFirst({
        where: { codigo: normalizedCode },
        select: {
          id: true,
          codigo: true,
          nome: true,
          whatsapp: true,
          user: {
            select: {
              id: true,
              nome: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      })) as ConsultorPublicOptionType | null;

      if (!consultor) continue;

      return {
        id: consultor.id,
        codigo: await ensureConsultorCode(tenantId, consultor),
        nome: formatConsultorDisplayName(consultor.nome, tenantId),
        nomeCompleto: consultor.nome,
        whatsapp: consultor.whatsapp ?? null,
        email: consultor.user?.email ?? null,
        avatarUrl: consultor.user?.avatarUrl ?? null,
        userId: consultor.user?.id ?? null,
        tenantId,
        tenantLabel: getTenantLabel(tenantId),
        selectionKey: buildSelectionKey(tenantId, consultor.id),
      };
    }

    return null;
  }

  static async resolvePublicByLegacyId(id: number, tenantId?: string | null) {
    const normalizedTenant = String(tenantId ?? '')
      .trim()
      .toLowerCase();
    if (!Number.isInteger(id) || id <= 0 || !normalizedTenant) return null;

    const prisma = getPrismaForTenant(normalizedTenant);
    const consultor = (await prisma.consultor.findFirst({
      where: { id },
      select: {
        id: true,
        codigo: true,
        nome: true,
        whatsapp: true,
        user: {
          select: {
            id: true,
            nome: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    })) as ConsultorPublicOptionType | null;

    if (!consultor) return null;

    return {
      id: consultor.id,
      codigo: await ensureConsultorCode(normalizedTenant, consultor),
      nome: formatConsultorDisplayName(consultor.nome, normalizedTenant),
      nomeCompleto: consultor.nome,
      whatsapp: consultor.whatsapp ?? null,
      email: consultor.user?.email ?? null,
      avatarUrl: consultor.user?.avatarUrl ?? null,
      userId: consultor.user?.id ?? null,
      tenantId: normalizedTenant,
      tenantLabel: getTenantLabel(normalizedTenant),
      selectionKey: buildSelectionKey(normalizedTenant, consultor.id),
    };
  }

  async getById(id: number): Promise<ConsultorType | null> {
    const consultor = await this.prisma.consultor.findUnique({ where: { id: Number(id) } });
    if (consultor) {
      await ensureConsultorCode(this.tenantId, consultor);
    }
    return this.prisma.consultor.findUnique({ where: { id: Number(id) } });
  }

  async create(data: ConsultorType): Promise<ConsultorType> {
    const created = await this.prisma.consultor.create({ data });
    await ensureConsultorCode(this.tenantId, created);
    return this.prisma.consultor.findUniqueOrThrow({ where: { id: created.id } });
  }

  async update(id: number, data: Partial<ConsultorType>): Promise<ConsultorType> {
    const updated = await this.prisma.consultor.update({ where: { id: Number(id) }, data });
    await ensureConsultorCode(this.tenantId, updated);
    return this.prisma.consultor.findUniqueOrThrow({ where: { id: Number(id) } });
  }

  async delete(id: number): Promise<ConsultorType> {
    return this.prisma.consultor.delete({ where: { id: Number(id) } });
  }

  async getResumoByUserId(userId: number) {
    const consultor = (await this.prisma.consultor.findUnique({
      where: { userId: Number(userId) },
      include: {
        user: {
          select: {
            id: true,
            nome: true,
            email: true,
          },
        },
      },
    })) as ConsultorResumoType | null;

    if (!consultor) return null;

    const [pendente, pago] = await Promise.all([
      this.prisma.comissao.aggregate({
        where: { vendedorId: consultor.id, statusPagamento: 'PENDENTE' },
        _sum: { valor: true },
      }),
      this.prisma.comissao.aggregate({
        where: { vendedorId: consultor.id, statusPagamento: 'PAGO' },
        _sum: { valor: true },
      }),
    ]);

    return {
      ...consultor,
      comissaoPendente: pendente._sum.valor ?? 0,
      comissaoPaga: pago._sum.valor ?? 0,
    };
  }

  async listarComissoesByUserId(userId: number) {
    const consultor = await this.prisma.consultor.findUnique({
      where: { userId: Number(userId) },
      select: { id: true, nome: true },
    });

    if (!consultor) return null;

    const comissoes = await this.prisma.comissao.findMany({
      where: { vendedorId: consultor.id },
      orderBy: { dataGeracao: 'desc' },
      include: {
        titular: {
          select: {
            id: true,
            nome: true,
            email: true,
            telefone: true,
          },
        },
        contaPagar: {
          select: {
            id: true,
            descricao: true,
            valor: true,
            status: true,
            vencimento: true,
            dataPagamento: true,
          },
        },
      },
    });

    return {
      consultor,
      comissoes,
      totais: {
        pendente: comissoes
          .filter((c) => c.statusPagamento === 'PENDENTE')
          .reduce((acc, c) => acc + (c.valor ?? 0), 0),
        pago: comissoes
          .filter((c) => c.statusPagamento === 'PAGO')
          .reduce((acc, c) => acc + (c.valor ?? 0), 0),
      },
    };
  }
}
