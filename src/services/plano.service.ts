import { Prisma, getPrismaForTenant } from '../utils/prisma';

type PlanoType = Prisma.PlanoGetPayload<{}>;

export type ParticipanteInput = {
  dataNascimento?: string | null;
  idade?: number | null;
  nome?: string | null;
};

export class PlanoService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }
    this.prisma = getPrismaForTenant(tenantId);
  }

  // -------- CRUD básico --------
  async getAll(): Promise<PlanoType[]> {
    const planos = await this.prisma.plano.findMany({
      include: {
        beneficiarios: true,
        coberturas: true,
      },
    });

    return planos.map((plano) => ({
      id: plano.id,
      nome: plano.nome,
      valorMensal: plano.valorMensal,
      idadeMaxima: plano.idadeMaxima,
      coberturaMaxima: plano.coberturaMaxima,
      carenciaDias: plano.carenciaDias,
      vigenciaMeses: plano.vigenciaMeses,
      ativo: plano.ativo,
      totalClientes: plano.totalClientes,
      receitaMensal: plano.receitaMensal,
      assistenciaFuneral: plano.assistenciaFuneral,
      auxilioCemiterio: plano.auxilioCemiterio,
      taxaInclusaCemiterioPublico: plano.taxaInclusaCemiterioPublico,
      beneficiarios: plano.beneficiarios.map((b) => b.nome),

      coberturas: {
        servicosPadrao: plano.coberturas
          .filter((c) => c.tipo === "servicosPadrao")
          .map((c) => c.descricao),
        coberturaTranslado: plano.coberturas
          .filter((c) => c.tipo === "coberturaTranslado")
          .map((c) => c.descricao),
        servicosEspecificos: plano.coberturas
          .filter((c) => c.tipo === "servicosEspecificos")
          .map((c) => c.descricao),
      },
    }));
  }

  async getPaged(params: {
    page?: number;
    pageSize?: number;
    ativo?: boolean;
    nome?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

    const where: Prisma.PlanoWhereInput = {
      AND: [
        params.ativo === undefined ? { ativo: true } : { ativo: params.ativo },
        params.nome ? { nome: { contains: params.nome } } : {},
      ],
    };

    const [data, total] = await Promise.all([
      this.prisma.plano.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
        select: { id: true, nome: true, valorMensal: true, idadeMaxima: true, ativo: true },
      }),
      this.prisma.plano.count({ where }),
    ]);

    return {
      data,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getById(id: number): Promise<PlanoType | null> {
    return this.prisma.plano.findUnique({ where: { id: Number(id) } });
  }

  async create(data: PlanoType): Promise<PlanoType> {
    return this.prisma.plano.create({ data });
  }

  async update(id: number, data: Partial<PlanoType>): Promise<PlanoType> {
    return this.prisma.plano.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<PlanoType> {
    return this.prisma.plano.delete({ where: { id: Number(id) } });
  }

  // -------- Regras para sugestão de plano --------
  private calcularIdade(isoDate: string): number {
    const hoje = new Date();
    const nasc = new Date(isoDate);
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return idade;
  }

  private normalizarIdades(participantes: ParticipanteInput[]): number[] {
    return participantes.map((p) => {
      if (p?.idade != null) return Number(p.idade);
      if (p?.dataNascimento) return this.calcularIdade(p.dataNascimento);
      return 0; // fallback; personalize caso idade seja obrigatória
    });
  }

  private elegivelPorIdade(plano: { idadeMaxima: number | null }, idades: number[]): boolean {
    if (plano.idadeMaxima == null) return true;
    return idades.every((i) => i <= (plano.idadeMaxima as number));
  }

  /**
   * Retorna o melhor plano (ou todos) com base nas idades.
   * Agora inclui os BENEFÍCIOS já achatados no retorno.
   */
  async sugerirPlano(participantes: ParticipanteInput[], retornarTodos = false) {
    const idades = this.normalizarIdades(participantes);

    const planosAtivos = await this.prisma.plano.findMany({
      where: { ativo: true },
      orderBy: [{ valorMensal: 'asc' }, { id: 'asc' }],
      include: {
        beneficios: {
          include: {
            beneficio: {
              select: {
                id: true,
                nome: true,
                tipo: true,
                descricao: true,
                valor: true,
                validade: true,
              },
            },
          },
        },
        coberturas: { select: { id: true, tipo: true, descricao: true } },
        beneficiarios: { select: { id: true, nome: true } },
      },
    });

    // --- helpers de normalização e scoring ---
    const normBool = (v: any) => v === true || v === 1 || v === '1';
    const normIdadeMax = (v: number | null | undefined) =>
      v == null || v >= 999 ? null : v;

    const relCount = (p: any) =>
      (p.beneficios?.length ?? 0) +
      (p.coberturas?.length ?? 0) +
      (p.beneficiarios?.length ?? 0);

    const scorePlano = (p: any) => {
      let s = relCount(p);
      if ((p.assistenciaFuneral ?? 0) > 0) s += 2;
      if (p.auxilioCemiterio != null && Number(p.auxilioCemiterio) > 0) s += 2;
      if (normBool(p.taxaInclusaCemiterioPublico)) s += 1;
      return s;
    };

    const keyPlano = (p: any) =>
      [
        p.nome,
        Number(p.valorMensal).toFixed(2),        // agrupa por preço
        String(normIdadeMax(p.idadeMaxima)),     // normaliza 999 -> null
      ].join('|');

    // 1) Filtra por elegibilidade de idade
    const elegiveis = planosAtivos.filter((pl) => this.elegivelPorIdade(pl, idades));

    // 2) Deduplica por (nome|valorMensal|idadeMaxima-normalizada),
    //    escolhendo a "melhor" cópia pelo score; empate por id DESC.
    const byKey = new Map<string, any>();
    for (const p of elegiveis) {
      const k = keyPlano(p);
      const cur = byKey.get(k);
      if (!cur) {
        byKey.set(k, p);
      } else {
        const a = scorePlano(cur);
        const b = scorePlano(p);
        if (b > a || (b === a && p.id > cur.id)) {
          byKey.set(k, p);
        }
      }
    }

    // 3) Normaliza o shape de saída
    const dedup = Array.from(byKey.values()).map((pl) => ({
      id: pl.id,
      nome: pl.nome,
      valorMensal: pl.valorMensal,
      idadeMaxima: pl.idadeMaxima,
      ativo: pl.ativo,
      beneficios: (pl.beneficios ?? []).map((pb: any) => pb.beneficio),
      coberturas: pl.coberturas ?? [],
      beneficiarios: pl.beneficiarios ?? [],
      // (opcional: pode expor campos extras também)
      assistenciaFuneral: pl.assistenciaFuneral ?? 0,
      auxilioCemiterio: pl.auxilioCemiterio ?? null,
      taxaInclusaCemiterioPublico: normBool(pl.taxaInclusaCemiterioPublico),
    }));

    // 4) Ordenação final para retorno consistente
    dedup.sort(
      (a, b) => (a.valorMensal - b.valorMensal) || a.nome.localeCompare(b.nome) || (a.id - b.id)
    );

    return retornarTodos ? dedup : (dedup[0] ?? null);
  }


  /**
   * Vincula (ou desvincula se planoId = null) um plano ao titular
   */
  async vincularPlanoAoTitular(titularId: number, planoId: number | null) {
    if (planoId) {
      const plano = await this.prisma.plano.findUnique({ where: { id: planoId } });
      if (!plano || !plano.ativo) {
        throw new Error('Plano inválido ou inativo.');
      }
    }

    return this.prisma.titular.update({
      where: { id: titularId },
      data: { planoId: planoId ?? undefined },
      select: { id: true, nome: true, planoId: true },
    });
  }
}
