import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { CadastroTitularRequest } from '../types/titular';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

type TitularType = Prisma.TitularGetPayload<{}>;
type TitularWithRelations = Prisma.TitularGetPayload<{
  include: {
    dependentes: true;
    corresponsaveis: true;
    plano: {
      include: {
        coberturas: true;
        beneficios: true;
        beneficiarios: true;
      };
    };
    pagamentos: true;
    vendedor: true;
  };
}>;

export class TitularService {
  private prisma;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
  }

  async getAll(params?: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    plano?: string;
  }) {
    const { page = 1, limit = 10, search, status, plano } = params || {};

    const where: any = {};

    if (search) {
      const term = search.trim();
      where.OR = [
        { nome: { contains: term } },
        { email: { contains: term } },
        { cpf: { contains: term } },
        { telefone: { contains: term } },
      ];
    }

    if (status && status !== "todos") {
      where.statusPlano = status;
    }

    if (plano && plano !== "todos") {
      where.plano = { nome: plano };
    }

    const [data, total] = await Promise.all([
      this.prisma.titular.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          plano: true,
          dependentes: true,
        },
        orderBy: { nome: "asc" },
      }),
      this.prisma.titular.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getById(id: number): Promise<TitularWithRelations | null> {
    return this.prisma.titular.findUnique({
      where: { id: Number(id) },
      include: {
        dependentes: true,
        corresponsaveis: true,
        plano: {
          include: {
            coberturas: true,
            beneficios: true,
            beneficiarios: true,
          },
        },
        pagamentos: true,
        vendedor: true,
      },
    });
  }

  async create(data: TitularType): Promise<TitularType> {
    return this.prisma.titular.create({ data });
  }

   async createFull(data: CadastroTitularRequest) {
    const { step1, step2, step3, dependentes, step5 } = data;

    // --- Validações básicas ---
    if (!step1.email || !step1.cpf) {
      throw Object.assign(new Error('Email e CPF são obrigatórios'), { status: 400 });
    }

    // Normaliza email e CPF
    const email = step1.email.trim().toLowerCase();
    const cpf = step1.cpf.replace(/\D/g, '');

    // --- Verifica duplicidade ---
    const existente = await this.prisma.titular.findFirst({
      where: {
        OR: [{ email }, { cpf }],
      },
      select: { id: true, email: true, cpf: true },
    });

    if (existente) {
      const err: any = new Error('Já existe um titular cadastrado com este e-mail ou CPF.');
      err.status = 409;
      err.code = 'TITULAR_DUPLICADO';
      err.meta = existente;
      throw err;
    }

    // --- Monta dados do corresponsável ---
    const usarMesmosDados = step3.usarMesmosDados;
    const corresponsavelData = usarMesmosDados
      ? {
          nome: step1.nomeCompleto,
          email: email,
          telefone: step1.telefone,
          relacionamento: 'Titular',
        }
      : {
          nome: step3.nomeCompleto || 'Sem nome',
          email: (step3.email || '').trim().toLowerCase(),
          telefone: step3.telefone,
          relacionamento: step3.parentesco || 'Outro',
        };

    // --- Monta dependentes ---
    const dependentesData = dependentes?.map((dep) => ({
      nome: dep.nome,
      tipoDependente: dep.parentesco || 'Outro',
      dataNascimento: dep.dataNascimento
        ? new Date(dep.dataNascimento)
        : new Date(),
    }));
    const planoIdSelecionado = step5?.planoId ? Number(step5.planoId) : null;

    try {
      // --- Criação transacional ---
      const novoTitular = await this.prisma.$transaction(async (tx) => {
        const titular = await tx.titular.create({
          data: {
            nome: step1.nomeCompleto,
            email,
            telefone: step1.telefone,
            dataNascimento: new Date(step1.dataNascimento),
            statusPlano: 'ATIVO',
            dataContratacao: new Date(),
            cpf,
            cep: step2.cep,
            uf: step2.uf,
            cidade: step2.cidade,
            bairro: step2.bairro,
            logradouro: step2.logradouro,
            complemento: step2.complemento,
            numero: step2.numero,
            plano: planoIdSelecionado
              ? {
                  connect: {
                    id: planoIdSelecionado,
                  },
                }
              : undefined,
            dependentes: dependentesData?.length
              ? { create: dependentesData }
              : undefined,
            corresponsaveis: { create: [corresponsavelData] },
          },
          include: {
            dependentes: true,
            corresponsaveis: true,
          },
        });

        return titular;
      });

      return novoTitular;
    } catch (e: any) {
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        const err: any = new Error('Titular já existe (violação de chave única)');
        err.status = 409;
        err.code = 'EMAIL_OR_CPF_DUPLICADO';
        throw err;
      }
      throw e;
    }
  }

  async update(id: number, data: Partial<TitularType>): Promise<TitularType> {
    return this.prisma.titular.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<TitularType> {
    return this.prisma.titular.delete({ where: { id: Number(id) } });
  }
}
