import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { canonicalizeRelationship, isRelationshipInGrade } from './family-relationship.service';
import { TitularPricingService } from './titular-pricing.service';

type PlanoType = Prisma.PlanoGetPayload<{}>;
type PlanoInput = Omit<Prisma.PlanoCreateInput, 'beneficiarios'> & {
  beneficiarios?: string[];
  coberturas?: unknown;
};

export type ParticipanteInput = {
  dataNascimento?: string | null;
  idade?: number | null;
  nome?: string | null;
  parentesco?: string | null;
};

export class PlanoService {
  private prisma;
  private pricingService: TitularPricingService;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }
    this.prisma = getPrismaForTenant(tenantId);
    this.pricingService = new TitularPricingService(tenantId);
  }

  private createValidationError(message: string) {
    const error: Error & { status?: number } = new Error(message);
    error.status = 400;
    return error;
  }

  // -------- CRUD básico --------
  private normalizarBeneficiarios(beneficiarios: unknown): string[] {
    if (!Array.isArray(beneficiarios)) return [];

    return beneficiarios
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(
        (nome, index, array): nome is string =>
          nome.length > 0 && array.indexOf(nome) === index,
      );
  }

  private buildPlanoCreateData(data: PlanoInput): Prisma.PlanoCreateInput {
    const nome = String(data.nome ?? '').trim();
    const valorMensal = Number(data.valorMensal);
    const coberturaMaxima = Number(data.coberturaMaxima ?? 0);
    const carenciaDias = Number(data.carenciaDias ?? 0);
    const vigenciaMeses = Number(data.vigenciaMeses ?? 0);

    if (!nome) {
      throw this.createValidationError('Nome do plano é obrigatório');
    }
    if (!Number.isFinite(valorMensal) || valorMensal < 0) {
      throw this.createValidationError('valorMensal inválido');
    }
    if (!Number.isFinite(coberturaMaxima) || coberturaMaxima < 0) {
      throw this.createValidationError('coberturaMaxima inválida');
    }
    if (!Number.isFinite(carenciaDias) || carenciaDias < 0) {
      throw this.createValidationError('carenciaDias inválido');
    }
    if (!Number.isFinite(vigenciaMeses) || vigenciaMeses < 0) {
      throw this.createValidationError('vigenciaMeses inválido');
    }

    return {
      nome,
      valorMensal,
      idadeMaxima: data.idadeMaxima ?? null,
      coberturaMaxima,
      carenciaDias,
      vigenciaMeses,
      ativo: data.ativo ?? true,
      totalClientes: Number(data.totalClientes ?? 0),
      receitaMensal: Number(data.receitaMensal ?? 0),
      assistenciaFuneral: Number(data.assistenciaFuneral ?? 0),
      auxilioCemiterio:
        data.auxilioCemiterio === undefined || data.auxilioCemiterio === null
          ? null
          : Number(data.auxilioCemiterio),
      taxaInclusaCemiterioPublico: Boolean(data.taxaInclusaCemiterioPublico ?? false),
    };
  }

  private buildPlanoUpdateData(data: Partial<PlanoInput>): Prisma.PlanoUpdateInput {
    const payload: Prisma.PlanoUpdateInput = {};
    if (data.nome !== undefined) {
      const nome = String(data.nome).trim();
      if (!nome) throw this.createValidationError('Nome do plano é obrigatório');
      payload.nome = nome;
    }
    if (data.valorMensal !== undefined) {
      const valorMensal = Number(data.valorMensal);
      if (!Number.isFinite(valorMensal) || valorMensal < 0) {
        throw this.createValidationError('valorMensal inválido');
      }
      payload.valorMensal = valorMensal;
    }
    if (data.idadeMaxima !== undefined) payload.idadeMaxima = data.idadeMaxima;
    if (data.coberturaMaxima !== undefined) {
      const coberturaMaxima = Number(data.coberturaMaxima);
      if (!Number.isFinite(coberturaMaxima) || coberturaMaxima < 0) {
        throw this.createValidationError('coberturaMaxima inválida');
      }
      payload.coberturaMaxima = coberturaMaxima;
    }
    if (data.carenciaDias !== undefined) {
      const carenciaDias = Number(data.carenciaDias);
      if (!Number.isFinite(carenciaDias) || carenciaDias < 0) {
        throw this.createValidationError('carenciaDias inválido');
      }
      payload.carenciaDias = carenciaDias;
    }
    if (data.vigenciaMeses !== undefined) {
      const vigenciaMeses = Number(data.vigenciaMeses);
      if (!Number.isFinite(vigenciaMeses) || vigenciaMeses < 0) {
        throw this.createValidationError('vigenciaMeses inválido');
      }
      payload.vigenciaMeses = vigenciaMeses;
    }
    if (data.ativo !== undefined) payload.ativo = Boolean(data.ativo);
    if (data.totalClientes !== undefined) payload.totalClientes = Number(data.totalClientes);
    if (data.receitaMensal !== undefined) payload.receitaMensal = Number(data.receitaMensal);
    if (data.assistenciaFuneral !== undefined)
      payload.assistenciaFuneral = Number(data.assistenciaFuneral);
    if (data.auxilioCemiterio !== undefined) payload.auxilioCemiterio = data.auxilioCemiterio;
    if (data.taxaInclusaCemiterioPublico !== undefined) {
      payload.taxaInclusaCemiterioPublico = Boolean(data.taxaInclusaCemiterioPublico);
    }
    return payload;
  }

  private normalizarCoberturas(
    coberturas: unknown,
  ): Array<{ tipo: string; descricao: string }> {
    const registros: Array<{ tipo: string; descricao: string }> = [];
    const add = (tipo: string, descricao: string) => {
      const tipoNormalizado = String(tipo ?? '').trim();
      const descricaoNormalizada = String(descricao ?? '').trim();
      if (!tipoNormalizado || !descricaoNormalizada) return;
      registros.push({
        tipo: tipoNormalizado,
        descricao: descricaoNormalizada,
      });
    };

    if (Array.isArray(coberturas)) {
      coberturas.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const registro = item as Record<string, unknown>;
        if (typeof registro.tipo !== 'string' || typeof registro.descricao !== 'string') return;
        add(registro.tipo, registro.descricao);
      });
    } else if (coberturas && typeof coberturas === 'object') {
      const registro = coberturas as Record<string, unknown>;
      const pushStrings = (tipo: string, lista: unknown) => {
        if (!Array.isArray(lista)) return;
        lista.forEach((descricao) => {
          if (typeof descricao === 'string') add(tipo, descricao);
        });
      };

      pushStrings('servicosPadrao', registro.servicosPadrao);
      pushStrings('coberturaTranslado', registro.coberturaTranslado);
      pushStrings('servicosEspecificos', registro.servicosEspecificos);
    }

    const unicos = new Map<string, { tipo: string; descricao: string }>();
    registros.forEach((item) => {
      const chave = `${item.tipo.toLowerCase()}|${item.descricao.toLowerCase()}`;
      if (!unicos.has(chave)) {
        unicos.set(chave, item);
      }
    });

    return Array.from(unicos.values());
  }

  async getAll(): Promise<PlanoType[]> {
    const planos = await this.prisma.plano.findMany({
      include: {
        beneficiarios: true,
        coberturas: true,
      },
    });

    const normalizarIdadeMaxima = (idade: number | null) => {
      if (idade === null || idade === undefined) return null;
      if (idade >= 999) return null;
      return idade;
    };

    const construirRegistro = (plano: (typeof planos)[number]) => ({
      id: plano.id,
      nome: plano.nome,
      valorMensal: plano.valorMensal,
      idadeMaxima: normalizarIdadeMaxima(plano.idadeMaxima),
      coberturaMaxima: plano.coberturaMaxima,
      carenciaDias: plano.carenciaDias,
      vigenciaMeses: plano.vigenciaMeses,
      ativo: plano.ativo,
      totalClientes: plano.totalClientes,
      receitaMensal: plano.receitaMensal,
      assistenciaFuneral: plano.assistenciaFuneral,
      auxilioCemiterio: plano.auxilioCemiterio,
      taxaInclusaCemiterioPublico: plano.taxaInclusaCemiterioPublico,
      beneficiarios: plano.beneficiarios.map((b) => ({
        id: b.id,
        nome: b.nome,
      })),

      coberturas: {
        servicosPadrao: plano.coberturas
          .filter((c) => c.tipo === 'servicosPadrao')
          .map((c) => c.descricao),
        coberturaTranslado: plano.coberturas
          .filter((c) => c.tipo === 'coberturaTranslado')
          .map((c) => c.descricao),
        servicosEspecificos: plano.coberturas
          .filter((c) => c.tipo === 'servicosEspecificos')
          .map((c) => c.descricao),
      },
    });

    const deduplicados = new Map<string, ReturnType<typeof construirRegistro>>();
    for (const plano of planos) {
      const payload = construirRegistro(plano);
      const key = [
        payload.nome?.toLowerCase().trim() ?? '',
        Number(payload.valorMensal).toFixed(2),
        payload.idadeMaxima ?? 'sem-limite',
      ].join('|');

      if (!deduplicados.has(key)) {
        deduplicados.set(key, payload);
      } else {
        const existente = deduplicados.get(key)!;
        if (
          existente.coberturas.servicosPadrao.length +
            existente.coberturas.coberturaTranslado.length +
            existente.coberturas.servicosEspecificos.length <
          payload.coberturas.servicosPadrao.length +
            payload.coberturas.coberturaTranslado.length +
            payload.coberturas.servicosEspecificos.length
        ) {
          deduplicados.set(key, payload);
        }
      }
    }

    return Array.from(deduplicados.values());
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

  async create(data: PlanoInput): Promise<PlanoType> {
    const beneficiarios = this.normalizarBeneficiarios(data.beneficiarios);
    const coberturas = this.normalizarCoberturas(data.coberturas);
    const planoData = this.buildPlanoCreateData(data);

    return this.prisma.plano.create({
      data: {
        ...planoData,
        beneficiarios:
          beneficiarios.length > 0
            ? {
              create: beneficiarios.map((nome) => ({ nome })),
              }
            : undefined,
        coberturas:
          coberturas.length > 0
            ? {
                create: coberturas.map((item) => ({
                  tipo: item.tipo,
                  descricao: item.descricao,
                })),
              }
            : undefined,
      },
    });
  }

  async update(id: number, data: Partial<PlanoInput>): Promise<PlanoType> {
    const planoData = this.buildPlanoUpdateData(data);
    const beneficiarios =
      data.beneficiarios === undefined
        ? undefined
        : this.normalizarBeneficiarios(data.beneficiarios);
    const coberturas =
      data.coberturas === undefined ? undefined : this.normalizarCoberturas(data.coberturas);

    return this.prisma.plano.update({
      where: { id: Number(id) },
      data: {
        ...planoData,
        ...(beneficiarios !== undefined
          ? {
              beneficiarios: {
                deleteMany: {},
                create: beneficiarios.map((nome) => ({ nome })),
              },
            }
          : {}),
        ...(coberturas !== undefined
          ? {
              coberturas: {
                deleteMany: {},
                create: coberturas.map((item) => ({
                  tipo: item.tipo,
                  descricao: item.descricao,
                })),
              },
            }
          : {}),
      },
    });
  }

  async delete(id: number): Promise<PlanoType> {
    const planoId = Number(id);
    return this.prisma.$transaction(async (tx) => {
      await tx.planoBeneficiario.deleteMany({ where: { planoId } });
      await tx.planoCobertura.deleteMany({ where: { planoId } });
      return tx.plano.delete({ where: { id: planoId } });
    });
  }

  // -------- Regras para sugestão de plano --------
  private calcularIdade(isoDate: string): number {
    const hoje = new Date();
    let ano: number;
    let mes: number;
    let dia: number;

    const normalized = String(isoDate ?? '').trim();
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (match) {
      ano = Number(match[1]);
      mes = Number(match[2]);
      dia = Number(match[3]);
    } else {
      const nasc = new Date(normalized);
      if (Number.isNaN(nasc.getTime())) return 0;
      ano = nasc.getFullYear();
      mes = nasc.getMonth() + 1;
      dia = nasc.getDate();
    }

    let idade = hoje.getFullYear() - ano;
    const deltaMes = hoje.getMonth() + 1 - mes;
    if (deltaMes < 0 || (deltaMes === 0 && hoje.getDate() < dia)) idade--;
    return idade;
  }

  private normalizarIdades(participantes: ParticipanteInput[]): number[] {
    return participantes.map((p) => {
      if (p?.idade != null) return Number(p.idade);
      if (p?.dataNascimento) return this.calcularIdade(p.dataNascimento);
      return 0; // fallback; personalize caso idade seja obrigatória
    });
  }

  private selecionarPlanoPorMaiorIdade<T extends { idadeMaxima: number | null }>(
    planos: T[],
    maiorIdade: number,
  ): T | null {
    const faixas = planos
      .filter((plano) => typeof plano.idadeMaxima === 'number' && Number.isFinite(plano.idadeMaxima))
      .sort((a, b) => (a.idadeMaxima as number) - (b.idadeMaxima as number));
    const planoSemLimite = planos.find((plano) => plano.idadeMaxima == null) ?? null;

    if (faixas.length === 0) {
      return planoSemLimite;
    }

    const faixaCompativel = faixas.find(
      (plano) => maiorIdade <= (plano.idadeMaxima as number),
    );

    if (faixaCompativel) {
      return faixaCompativel;
    }

    return planoSemLimite;
  }

  private normalizarNomePlano(nome?: string | null): string {
    return String(nome ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isPlanoSocial(nome?: string | null): boolean {
    const normalizado = this.normalizarNomePlano(nome);
    return normalizado.includes('social');
  }

  private isPlanoEssencial(nome?: string | null): boolean {
    const normalizado = this.normalizarNomePlano(nome);
    return normalizado.includes('essencial');
  }

  private isElegivelSocialEssencial(participantes: ParticipanteInput[]): boolean {
    if (!participantes.length) return false;

    const parentescosPermitidos = new Set(['titular', 'conjuge', 'filho', 'neto']);
    const idades = this.normalizarIdades(participantes);

    if (idades.some((idade) => !Number.isFinite(idade) || idade > 55)) {
      return false;
    }

    return participantes.every((participante) => {
      const parentesco = canonicalizeRelationship(participante.parentesco);
      return parentescosPermitidos.has(parentesco);
    });
  }

  private selecionarPlanosCompativeisPorMaiorIdade<T extends { idadeMaxima: number | null; nome?: string | null }>(
    planos: T[],
    maiorIdade: number,
    permitirSocialEssencial: boolean,
  ): T[] {
    const faixas = planos
      .filter((plano) => typeof plano.idadeMaxima === 'number' && Number.isFinite(plano.idadeMaxima))
      .sort((a, b) => (a.idadeMaxima as number) - (b.idadeMaxima as number));
    const planoSemLimite = planos.filter((plano) => plano.idadeMaxima == null);
    const faixaCompativel = faixas.find((plano) => maiorIdade <= (plano.idadeMaxima as number));
    const idadeFaixa = faixaCompativel?.idadeMaxima ?? null;

    let compativeis = idadeFaixa == null
      ? planoSemLimite
      : planos.filter((plano) => plano.idadeMaxima === idadeFaixa);

    if (permitirSocialEssencial) {
      const socialEssencial = planos.filter(
        (plano) => this.isPlanoSocial(plano.nome) || this.isPlanoEssencial(plano.nome),
      );
      if (socialEssencial.length > 0) {
        compativeis = socialEssencial;
      }
    }

    if (!permitirSocialEssencial) {
      compativeis = compativeis.filter((plano) => !this.isPlanoSocial(plano.nome));
    }

    return compativeis;
  }

  private elegivelPorComposicao(
    plano: { beneficiarios: Array<{ nome: string }> },
    participantes: ParticipanteInput[],
  ): boolean {
    const dependentes = participantes.filter((p) => {
      const parentesco = canonicalizeRelationship(p.parentesco);
      return parentesco !== 'titular';
    });

    if (dependentes.length === 0) return true;

    const beneficiariosPlano = plano.beneficiarios.map((b) => b.nome);
    return dependentes.every((p) =>
      isRelationshipInGrade(p.parentesco, beneficiariosPlano),
    );
  }

  /**
   * Retorna o melhor plano (ou todos) com base nas idades.
   * Agora inclui os BENEFÍCIOS já achatados no retorno.
   */
  async sugerirPlano(
    participantes: ParticipanteInput[],
    retornarTodos = false,
    ignorarComposicao = false,
  ) {
    const idades = this.normalizarIdades(participantes);
    const maiorIdade = idades.length > 0 ? Math.max(...idades) : 0;

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

    // 1) Filtra por composicao familiar. A faixa etaria e resolvida na selecao final.
    const elegiveis = ignorarComposicao
      ? planosAtivos
      : planosAtivos.filter((pl) => this.elegivelPorComposicao(pl, participantes));

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
      (a, b) => {
        const idadeA = a.idadeMaxima ?? Number.POSITIVE_INFINITY;
        const idadeB = b.idadeMaxima ?? Number.POSITIVE_INFINITY;
        return (
          idadeA - idadeB ||
          a.valorMensal - b.valorMensal ||
          a.nome.localeCompare(b.nome) ||
          a.id - b.id
        );
      },
    );

    if (retornarTodos) {
      return dedup;
    }

    const permitirSocialEssencial = this.isElegivelSocialEssencial(participantes);
    const compativeis = this.selecionarPlanosCompativeisPorMaiorIdade(
      dedup,
      maiorIdade,
      permitirSocialEssencial,
    );

    return compativeis[0] ?? this.selecionarPlanoPorMaiorIdade(dedup, maiorIdade);
  }

  async listarPlanosCompativeis(participantes: ParticipanteInput[]) {
    const todos = (await this.sugerirPlano(participantes, true)) as Array<{
      id: number;
      nome: string;
      valorMensal: number;
      idadeMaxima: number | null;
      ativo: boolean;
      beneficios: unknown[];
      coberturas: unknown[];
      beneficiarios: Array<{ id: number; nome: string }>;
      assistenciaFuneral: number;
      auxilioCemiterio: number | null;
      taxaInclusaCemiterioPublico: boolean;
    }>;
    const idades = this.normalizarIdades(participantes);
    const maiorIdade = idades.length > 0 ? Math.max(...idades) : 0;
    const permitirSocialEssencial = this.isElegivelSocialEssencial(participantes);

    return this.selecionarPlanosCompativeisPorMaiorIdade(
      todos,
      maiorIdade,
      permitirSocialEssencial,
    );
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

    const titular = await this.prisma.titular.update({
      where: { id: titularId },
      data: { planoId: planoId ?? undefined },
      select: { id: true, nome: true, planoId: true },
    });
    await this.pricingService.recalcularDependentesDoTitular(titular.id);
    return titular;
  }
}
