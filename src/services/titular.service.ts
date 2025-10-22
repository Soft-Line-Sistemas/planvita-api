import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { CadastroTitularRequest } from '../types/titular';

type TitularType = Prisma.TitularGetPayload<{}>;

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
      where.OR = [
        { nome: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { cpf: { contains: search, mode: "insensitive" } },
        { telefone: { contains: search, mode: "insensitive" } },
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

  async getById(id: number): Promise<TitularType | null> {
    return this.prisma.titular.findUnique({ where: { id: Number(id) } });
  }

  async create(data: TitularType): Promise<TitularType> {
    return this.prisma.titular.create({ data });
  }

  async createFull(data: CadastroTitularRequest) {
    const titularData = data.step1;
    const enderecoData = data.step2;
    const respData = data.step3;
    const dependentes = data.dependentes;

    // Se o responsável financeiro for igual ao titular
    const responsavel = respData.usarMesmosDados
      ? { ...titularData, parentesco: "Titular" }
      : respData;

      const responsavelData = respData.usarMesmosDados
        ? {
            nome: titularData.nomeCompleto || "Sem nome",
            email: titularData.email || "",
            telefone: titularData.telefone || undefined,
            relacionamento: "Titular",
          }
        : {
            nome: respData.nomeCompleto || "Sem nome",
            email: respData.email || "",
            telefone: respData.telefone || undefined,
            relacionamento: respData.parentesco || "Outro",
          };


    return this.prisma.titular.create({
      data: {
        nome: titularData.nomeCompleto,
        email: titularData.email,
        telefone: titularData.telefone,
        dataNascimento: new Date(titularData.dataNascimento),
        statusPlano: "ATIVO",
        dataContratacao: new Date(),
        // Endereço se tiver campos no Titular
        cep: enderecoData.cep,
        uf: enderecoData.uf,
        cidade: enderecoData.cidade,
        bairro: enderecoData.bairro,
        logradouro: enderecoData.logradouro,
        complemento: enderecoData.complemento,
        numero: enderecoData.numero,
        // Dependentes
        dependentes: {
          create: dependentes.map(dep => ({
            nome: dep.nome,
            dataNascimento: new Date(), // se quiser usar idade precisa calcular a data
            tipoDependente: dep.parentesco,
          }))
        },
        // Corresponsável financeiro, se houver tabela
       corresponsaveis: {
        create: [responsavelData],
      },
      },
      include: {
        dependentes: true,
        corresponsaveis: true,
      },
    });
  }

  async update(id: number, data: Partial<TitularType>): Promise<TitularType> {
    return this.prisma.titular.update({ where: { id: Number(id) }, data });
  }

  async delete(id: number): Promise<TitularType> {
    return this.prisma.titular.delete({ where: { id: Number(id) } });
  }
}
