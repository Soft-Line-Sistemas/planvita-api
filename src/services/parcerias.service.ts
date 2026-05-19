import { getPrismaForTenant } from '../utils/prisma';

type ListClienteParams = {
  q?: string;
  categoriaId?: number;
  destaque?: boolean;
  limit?: number;
  offset?: number;
};

type PublicListParams = {
  limit?: number;
};

const ACTIVE_PLAN_STATUS = ['ATIVO', 'ACTIVE'];

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export class ParceriasService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) throw new Error('Tenant ID must be provided');
    this.prisma = getPrismaForTenant(tenantId);
  }

  async listarCategorias() {
    return this.prisma.parceriaCategoria.findMany({
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
  }

  async salvarCategoria(payload: any) {
    const data = {
      nome: String(payload?.nome ?? '').trim(),
      slug: String(payload?.slug ?? slugify(String(payload?.nome ?? ''))).trim(),
      descricao: payload?.descricao ? String(payload.descricao) : null,
      icone: payload?.icone ? String(payload.icone) : null,
      ordem: Number(payload?.ordem ?? 0),
      ativo: Boolean(payload?.ativo ?? true),
    };
    if (!data.nome) throw new Error('Nome da categoria é obrigatório');
    if (!data.slug) throw new Error('Slug da categoria é obrigatório');

    if (payload?.id) {
      return this.prisma.parceriaCategoria.update({ where: { id: Number(payload.id) }, data });
    }
    return this.prisma.parceriaCategoria.create({ data });
  }

  async listarParceiros(q?: string) {
    return this.prisma.parceiro.findMany({
      where: q
        ? {
            OR: [
              { nome: { contains: q } },
              { cidade: { contains: q } },
              { uf: { contains: q } },
            ],
          }
        : undefined,
      orderBy: [{ destaque: 'desc' }, { ordem: 'asc' }, { nome: 'asc' }],
    });
  }

  async salvarParceiro(payload: any) {
    const data = {
      nome: String(payload?.nome ?? '').trim(),
      slug: String(payload?.slug ?? slugify(String(payload?.nome ?? ''))).trim(),
      descricaoCurta: payload?.descricaoCurta ? String(payload.descricaoCurta) : null,
      descricaoCompleta: payload?.descricaoCompleta ? String(payload.descricaoCompleta) : null,
      logoUrl: payload?.logoUrl ? String(payload.logoUrl) : null,
      bannerUrl: payload?.bannerUrl ? String(payload.bannerUrl) : null,
      siteUrl: payload?.siteUrl ? String(payload.siteUrl) : null,
      whatsapp: payload?.whatsapp ? String(payload.whatsapp) : null,
      telefone: payload?.telefone ? String(payload.telefone) : null,
      email: payload?.email ? String(payload.email) : null,
      endereco: payload?.endereco ? String(payload.endereco) : null,
      cidade: payload?.cidade ? String(payload.cidade) : null,
      uf: payload?.uf ? String(payload.uf) : null,
      ativo: Boolean(payload?.ativo ?? true),
      destaque: Boolean(payload?.destaque ?? false),
      ordem: Number(payload?.ordem ?? 0),
    };
    if (!data.nome) throw new Error('Nome do parceiro é obrigatório');
    if (!data.slug) throw new Error('Slug do parceiro é obrigatório');

    if (payload?.id) {
      return this.prisma.parceiro.update({ where: { id: Number(payload.id) }, data });
    }
    return this.prisma.parceiro.create({ data });
  }

  async listarVantagensAdmin(filters: any) {
    return this.prisma.parceriaVantagem.findMany({
      where: {
        status: filters?.status ? String(filters.status) : undefined,
        categoriaId: filters?.categoriaId ? Number(filters.categoriaId) : undefined,
        parceiroId: filters?.parceiroId ? Number(filters.parceiroId) : undefined,
        OR: filters?.q
          ? [
              { titulo: { contains: String(filters.q) } },
              { descricaoCurta: { contains: String(filters.q) } },
            ]
          : undefined,
      },
      include: {
        categoria: true,
        parceiro: true,
        planos: true,
      },
      orderBy: [{ destaque: 'desc' }, { ordem: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async salvarVantagem(payload: any) {
    const planoIds = Array.isArray(payload?.planoIds)
      ? payload.planoIds.map((id: any) => Number(id)).filter((n: number) => Number.isFinite(n))
      : [];

    const baseData = {
      parceiroId: Number(payload?.parceiroId),
      categoriaId: payload?.categoriaId ? Number(payload.categoriaId) : null,
      titulo: String(payload?.titulo ?? '').trim(),
      slug: String(payload?.slug ?? slugify(String(payload?.titulo ?? ''))).trim(),
      descricaoCurta: payload?.descricaoCurta ? String(payload.descricaoCurta) : null,
      descricaoCompleta: payload?.descricaoCompleta ? String(payload.descricaoCompleta) : null,
      tipo: String(payload?.tipo ?? 'CONVENIO').trim(),
      valorDesconto:
        payload?.valorDesconto !== undefined && payload?.valorDesconto !== null
          ? Number(payload.valorDesconto)
          : null,
      codigoCupom: payload?.codigoCupom ? String(payload.codigoCupom) : null,
      linkResgate: payload?.linkResgate ? String(payload.linkResgate) : null,
      instrucoesResgate: payload?.instrucoesResgate ? String(payload.instrucoesResgate) : null,
      regrasUso: payload?.regrasUso ? String(payload.regrasUso) : null,
      validadeInicio: payload?.validadeInicio ? new Date(payload.validadeInicio) : null,
      validadeFim: payload?.validadeFim ? new Date(payload.validadeFim) : null,
      publico: String(payload?.publico ?? 'CLIENTES_ATIVOS'),
      status: String(payload?.status ?? 'RASCUNHO'),
      destaque: Boolean(payload?.destaque ?? false),
      ordem: Number(payload?.ordem ?? 0),
    };

    if (!baseData.parceiroId || !baseData.titulo || !baseData.slug) {
      throw new Error('Parceiro, título e slug são obrigatórios');
    }

    if (payload?.id) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.parceriaVantagem.update({
          where: { id: Number(payload.id) },
          data: baseData,
        });
        await tx.parceriaVantagemPlano.deleteMany({ where: { vantagemId: updated.id } });
        if (planoIds.length) {
          await tx.parceriaVantagemPlano.createMany({
            data: planoIds.map((planoId: number) => ({ vantagemId: updated.id, planoId })),
          });
        }
        return updated;
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.parceriaVantagem.create({ data: baseData });
      if (planoIds.length) {
        await tx.parceriaVantagemPlano.createMany({
          data: planoIds.map((planoId: number) => ({ vantagemId: created.id, planoId })),
        });
      }
      return created;
    });
  }

  async excluirVantagem(id: number) {
    return this.prisma.parceriaVantagem.delete({ where: { id } });
  }

  private mapResumo(v: any, elegivel: boolean, motivoBloqueio: string | null) {
    return {
      id: v.id,
      slug: v.slug,
      titulo: v.titulo,
      descricaoCurta: v.descricaoCurta,
      tipo: v.tipo,
      valorDesconto: v.valorDesconto,
      validadeFim: v.validadeFim,
      destaque: v.destaque,
      elegivel,
      motivoBloqueio,
      categoria: v.categoria
        ? { id: v.categoria.id, nome: v.categoria.nome, slug: v.categoria.slug, icone: v.categoria.icone }
        : null,
      parceiro: {
        id: v.parceiro.id,
        nome: v.parceiro.nome,
        slug: v.parceiro.slug,
        logoUrl: v.parceiro.logoUrl,
        cidade: v.parceiro.cidade,
        uf: v.parceiro.uf,
      },
    };
  }

  private async getTitularData(titularId: number) {
    return this.prisma.titular.findUnique({
      where: { id: titularId },
      select: { id: true, planoId: true, statusPlano: true },
    });
  }

  private isTitularAtivo(statusPlano?: string | null): boolean {
    const normalized = String(statusPlano ?? '').toUpperCase();
    return ACTIVE_PLAN_STATUS.includes(normalized);
  }

  async listarCategoriasCliente() {
    return this.prisma.parceriaCategoria.findMany({ where: { ativo: true }, orderBy: [{ ordem: 'asc' }, { nome: 'asc' }] });
  }

  async listarVantagensCliente(titularId: number, params: ListClienteParams) {
    const titular = await this.getTitularData(titularId);
    if (!titular) throw new Error('Titular não encontrado');

    const now = new Date();
    const vantagens = await this.prisma.parceriaVantagem.findMany({
      where: {
        status: 'PUBLICADO',
        categoriaId: params.categoriaId,
        destaque: params.destaque,
        OR: params.q
          ? [
              { titulo: { contains: params.q } },
              { descricaoCurta: { contains: params.q } },
              { parceiro: { nome: { contains: params.q } } },
            ]
          : undefined,
        parceiro: { ativo: true },
        AND: [
          {
            OR: [{ validadeInicio: null }, { validadeInicio: { lte: now } }],
          },
          {
            OR: [{ validadeFim: null }, { validadeFim: { gte: now } }],
          },
        ],
      },
      include: { categoria: true, parceiro: true, planos: true },
      orderBy: [{ destaque: 'desc' }, { ordem: 'asc' }, { createdAt: 'desc' }],
      take: Math.min(Math.max(Number(params.limit ?? 20), 1), 100),
      skip: Math.max(Number(params.offset ?? 0), 0),
    });

    return vantagens.map((v) => {
      if (v.publico === 'PUBLICO') return this.mapResumo(v, true, null);
      if (!this.isTitularAtivo(titular.statusPlano)) {
        return this.mapResumo(v, false, 'Seu plano está inativo/suspenso. Regularize para resgatar.');
      }
      if (v.publico === 'PLANOS_ESPECIFICOS') {
        const elegivel = Boolean(titular.planoId) && v.planos.some((p) => p.planoId === titular.planoId);
        return this.mapResumo(v, elegivel, elegivel ? null : 'Vantagem indisponível para o seu plano atual.');
      }
      return this.mapResumo(v, true, null);
    });
  }

  async obterVantagemCliente(titularId: number, slug: string) {
    const titular = await this.getTitularData(titularId);
    if (!titular) throw new Error('Titular não encontrado');

    const now = new Date();
    const v = await this.prisma.parceriaVantagem.findFirst({
      where: {
        slug,
        status: 'PUBLICADO',
        parceiro: { ativo: true },
        AND: [
          { OR: [{ validadeInicio: null }, { validadeInicio: { lte: now } }] },
          { OR: [{ validadeFim: null }, { validadeFim: { gte: now } }] },
        ],
      },
      include: { categoria: true, parceiro: true, planos: true },
    });

    if (!v) return null;
    const resumo = await this.listarVantagensCliente(titularId, { q: v.titulo, limit: 100 });
    const current = resumo.find((item) => item.id === v.id);
    const elegivel = current?.elegivel ?? false;

    return {
      ...(current ?? this.mapResumo(v, elegivel, null)),
      descricaoCompleta: v.descricaoCompleta,
      regrasUso: v.regrasUso,
      instrucoesResgate: v.instrucoesResgate,
      codigoCupom: elegivel ? v.codigoCupom : null,
      linkResgate: elegivel ? v.linkResgate : null,
      whatsapp: elegivel ? v.parceiro.whatsapp : null,
    };
  }

  async registrarResgate(titularId: number, vantagemId: number, canal?: string) {
    return this.prisma.parceriaVantagemResgate.create({
      data: { titularId, vantagemId, canal: canal ? String(canal) : null },
    });
  }

  async listarVantagensPublicas(params: PublicListParams) {
    const now = new Date();
    const list = await this.prisma.parceriaVantagem.findMany({
      where: {
        status: 'PUBLICADO',
        parceiro: { ativo: true },
        publico: { in: ['PUBLICO', 'CLIENTES_ATIVOS', 'PLANOS_ESPECIFICOS'] },
        AND: [
          { OR: [{ validadeInicio: null }, { validadeInicio: { lte: now } }] },
          { OR: [{ validadeFim: null }, { validadeFim: { gte: now } }] },
        ],
      },
      include: { categoria: true, parceiro: true },
      orderBy: [{ destaque: 'desc' }, { ordem: 'asc' }, { createdAt: 'desc' }],
      take: Math.min(Math.max(Number(params.limit ?? 3), 1), 6),
    });

    return list.map((v) =>
      this.mapResumo(v, v.publico === 'PUBLICO', v.publico === 'PUBLICO' ? null : 'Exclusivo para clientes'),
    );
  }
}
