import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { getConfiguredPublicTenants, getTenantLabel } from '../utils/tenants';

type ConsultorType = Prisma.ConsultorGetPayload<{}>;
type ConsultorPublicOptionType = Prisma.ConsultorGetPayload<{
  select: {
    id: true;
    nome: true;
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
  nome: string;
  nomeCompleto: string;
  tenantId: string;
  tenantLabel: string;
  selectionKey: string;
};

function buildSelectionKey(tenantId: string, consultorId: number) {
  return `${tenantId}:${consultorId}`;
}

function formatConsultorDisplayName(nome: string, tenantId: string) {
  const partes = String(nome)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const resumido =
    partes.length <= 1 ? partes[0] ?? '' : `${partes[0]} ${partes[partes.length - 1]}`;
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
    return this.prisma.consultor.findMany();
  }

  async getPublicOptions(): Promise<ConsultorPublicOption[]> {
    const options = await this.prisma.consultor.findMany({
      select: {
        id: true,
        nome: true,
      },
      orderBy: {
        nome: 'asc',
      },
    });

    return options.map((option) => ({
      id: option.id,
      nome: formatConsultorDisplayName(option.nome, this.tenantId),
      nomeCompleto: option.nome,
      tenantId: this.tenantId,
      tenantLabel: getTenantLabel(this.tenantId),
      selectionKey: buildSelectionKey(this.tenantId, option.id),
    }));
  }

  static async getGlobalPublicOptions(): Promise<ConsultorPublicOption[]> {
    const tenants = getConfiguredPublicTenants();
    const resultados = await Promise.all(
      tenants.map(async (tenantId) => {
        const prisma = getPrismaForTenant(tenantId);
        const consultores = (await prisma.consultor.findMany({
          select: {
            id: true,
            nome: true,
          },
          orderBy: {
            nome: 'asc',
          },
        })) as ConsultorPublicOptionType[];

        return consultores.map((consultor) => ({
          id: consultor.id,
          nome: formatConsultorDisplayName(consultor.nome, tenantId),
          nomeCompleto: consultor.nome,
          tenantId,
          tenantLabel: getTenantLabel(tenantId),
          selectionKey: buildSelectionKey(tenantId, consultor.id),
        }));
      }),
    );

    return resultados
      .flat()
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  }

  async getById(id: number): Promise<ConsultorType | null> {
    return this.prisma.consultor.findUnique({ where: { id: Number(id) } });
  }

  async create(data: ConsultorType): Promise<ConsultorType> {
    return this.prisma.consultor.create({ data });
  }

  async update(id: number, data: Partial<ConsultorType>): Promise<ConsultorType> {
    return this.prisma.consultor.update({ where: { id: Number(id) }, data });
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
