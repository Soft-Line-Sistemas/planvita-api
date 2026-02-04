import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { CadastroTitularRequest } from '../types/titular';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Buffer } from 'buffer';
import { AsaasIntegrationService } from './asaas-integration.service';
import Logger from '../utils/logger';

type TitularType = Prisma.TitularGetPayload<{}>;

const TITULAR_FULL_INCLUDE = {
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
  // assinaturas: true,
} as const;

const TITULAR_LIST_INCLUDE = {
  plano: true,
  dependentes: true,
  // assinaturas: true,
} as const;

const FILES_API_BASE_URL = process.env.FILES_API_URL;
const ASSINATURA_TIPOS = [
  'TITULAR_ASSINATURA_1',
  'TITULAR_ASSINATURA_2',
  'CORRESPONSAVEL_ASSINATURA_1',
  'CORRESPONSAVEL_ASSINATURA_2',
] as const;
const ASSINATURA_ALLOWED_MIME = ['image/png', 'image/jpeg'];
const ASSINATURA_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_DIAS_SUSPENSAO = 90;
type AssinaturaDigitalType = {
  id: number;
  titularId: number;
  tipo: string;
  arquivoId: string;
  arquivoUrl: string;
  filename: string;
  mimetype: string | null;
  size: number | null;
  createdAt: Date;
  updatedAt: Date;
};
type AssinaturaTipo = (typeof ASSINATURA_TIPOS)[number];

export class TitularService {
  private prisma;
  private asaasIntegration: AsaasIntegrationService;
  private logger: Logger;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
    this.asaasIntegration = new AsaasIntegrationService(tenantId);
    this.logger = new Logger({ service: 'TitularService', tenantId });
  }

  private async obterLimiteBeneficiarios(): Promise<number | null> {
    const regras = await this.prisma.businessRules.findFirst({
      where: { tenantId: this.tenantId },
      select: { limiteBeneficiarios: true },
    });

    const limite = regras?.limiteBeneficiarios ?? null;
    if (!limite || limite <= 0) return null;
    return limite;
  }

  private async validarLimiteBeneficiariosCadastro(quantidadeDependentes: number) {
    const limite = await this.obterLimiteBeneficiarios();
    if (!limite) return;

    if (quantidadeDependentes > limite) {
      const err: any = new Error(
        `Quantidade de dependentes (${quantidadeDependentes}) excede o limite configurado (${limite}).`,
      );
      err.status = 400;
      err.code = 'LIMITE_BENEFICIARIOS_EXCEDIDO';
      err.meta = {
        limiteBeneficiarios: limite,
        totalDependentes: quantidadeDependentes,
      };
      throw err;
    }
  }

  private calcularDiasAtraso(vencimento: Date): number {
    const hoje = new Date();
    const diff = hoje.getTime() - new Date(vencimento).getTime();
    const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
    return dias > 0 ? dias : 0;
  }

  private async sincronizarStatusPlanoPorSuspensao(
    titularIds: number[],
  ): Promise<{ atualizadosAtivo: number; atualizadosSuspenso: number }> {
    if (!titularIds.length) {
      return { atualizadosAtivo: 0, atualizadosSuspenso: 0 };
    }

    const regras = await this.prisma.businessRules.findFirst({
      where: { tenantId: this.tenantId },
      select: { diasSuspensao: true },
    });
    const diasSuspensao =
      regras?.diasSuspensao && regras.diasSuspensao > 0
        ? regras.diasSuspensao
        : DEFAULT_DIAS_SUSPENSAO;

    const [titulares, contas] = await Promise.all([
      this.prisma.titular.findMany({
        where: { id: { in: titularIds } },
        select: { id: true, statusPlano: true },
      }),
      this.prisma.contaReceber.findMany({
        where: {
          clienteId: { in: titularIds },
          status: { in: ['PENDENTE', 'ATRASADO', 'PENDENCIA', 'VENCIDO'] },
        },
        select: { clienteId: true, vencimento: true },
      }),
    ]);

    const maiorAtrasoPorTitular = new Map<number, number>();
    contas.forEach((conta) => {
      if (!conta.clienteId) return;
      const atraso = this.calcularDiasAtraso(conta.vencimento);
      const atual = maiorAtrasoPorTitular.get(conta.clienteId) ?? 0;
      if (atraso > atual) {
        maiorAtrasoPorTitular.set(conta.clienteId, atraso);
      }
    });

    const idsParaAtivo: number[] = [];
    const idsParaSuspenso: number[] = [];

    titulares.forEach((titular) => {
      const statusAtual = String(titular.statusPlano ?? '').toUpperCase();
      if (!statusAtual || statusAtual === 'CANCELADO') return;

      const maiorAtraso = maiorAtrasoPorTitular.get(titular.id) ?? 0;
      const proximoStatus = maiorAtraso >= diasSuspensao ? 'SUSPENSO' : 'ATIVO';
      if (statusAtual === proximoStatus) return;

      if (proximoStatus === 'SUSPENSO') {
        idsParaSuspenso.push(titular.id);
      } else {
        idsParaAtivo.push(titular.id);
      }
    });

    if (!idsParaSuspenso.length && !idsParaAtivo.length) {
      return { atualizadosAtivo: 0, atualizadosSuspenso: 0 };
    }

    const operacoes = [
      ...(idsParaSuspenso.length
        ? [
            this.prisma.titular.updateMany({
              where: { id: { in: idsParaSuspenso } },
              data: { statusPlano: 'SUSPENSO' },
            }),
          ]
        : []),
      ...(idsParaAtivo.length
        ? [
            this.prisma.titular.updateMany({
              where: { id: { in: idsParaAtivo } },
              data: { statusPlano: 'ATIVO' },
            }),
          ]
        : []),
    ];

    const resultados = await this.prisma.$transaction(operacoes);
    let indice = 0;
    const atualizadosSuspenso = idsParaSuspenso.length
      ? (resultados[indice++] as any).count ?? 0
      : 0;
    const atualizadosAtivo = idsParaAtivo.length
      ? (resultados[indice++] as any).count ?? 0
      : 0;

    return { atualizadosAtivo, atualizadosSuspenso };
  }

  async sincronizarStatusPlanoLote(batchSize = 500): Promise<{
    totalProcessados: number;
    atualizadosAtivo: number;
    atualizadosSuspenso: number;
    batchSize: number;
  }> {
    const take = Math.max(50, Math.min(Math.floor(batchSize) || 500, 5000));
    let cursorId = 0;
    let totalProcessados = 0;
    let atualizadosAtivo = 0;
    let atualizadosSuspenso = 0;

    while (true) {
      const lote = await this.prisma.titular.findMany({
        where: { id: { gt: cursorId } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take,
      });

      if (!lote.length) break;

      const ids = lote.map((item) => item.id);
      const resultado = await this.sincronizarStatusPlanoPorSuspensao(ids);
      totalProcessados += ids.length;
      atualizadosAtivo += resultado.atualizadosAtivo;
      atualizadosSuspenso += resultado.atualizadosSuspenso;
      cursorId = ids[ids.length - 1];
    }

    return {
      totalProcessados,
      atualizadosAtivo,
      atualizadosSuspenso,
      batchSize: take,
    };
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

    const [dataInicial, total] = await Promise.all([
      this.prisma.titular.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: TITULAR_LIST_INCLUDE as any,
        orderBy: { nome: "asc" },
      }),
      this.prisma.titular.count({ where }),
    ]);

    const ids = dataInicial.map((t: any) => t.id).filter((id: unknown) => Number.isFinite(id as number)) as number[];
    if (ids.length) {
      await this.sincronizarStatusPlanoPorSuspensao(ids);
    }

    const data = await this.prisma.titular.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      include: TITULAR_LIST_INCLUDE as any,
      orderBy: { nome: "asc" },
    });

    return {
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getById(id: number) {
    await this.sincronizarStatusPlanoPorSuspensao([Number(id)]);
    return this.prisma.titular.findUnique({
      where: { id: Number(id) },
      include: TITULAR_FULL_INCLUDE as any,
    });
  }

  async create(data: TitularType): Promise<TitularType> {
    const titular = await this.prisma.titular.create({ data });
    void this.syncCustomerAsaasSafe(titular.id);
    return titular;
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
    await this.validarLimiteBeneficiariosCadastro(dependentesData?.length ?? 0);
    const planoIdSelecionado = step5?.planoId ? Number(step5.planoId) : null;
    const consultorIdInformado = data.consultorId ? Number(data.consultorId) : null;

    try {
      // --- Criação transacional ---
      const novoTitular = await this.prisma.$transaction(async (tx) => {
        const consultor =
          consultorIdInformado && Number.isFinite(consultorIdInformado)
            ? await tx.consultor.findFirst({
                where: {
                  OR: [{ id: consultorIdInformado }, { userId: consultorIdInformado }],
                },
                select: {
                  id: true,
                  nome: true,
                  valorComissaoIndicacao: true,
                },
              })
            : null;

        if (consultorIdInformado && !consultor) {
          const err: any = new Error('Consultor informado não encontrado.');
          err.status = 400;
          err.code = 'CONSULTOR_INVALIDO';
          throw err;
        }

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
            vendedor: consultor
              ? {
                  connect: {
                    id: consultor.id,
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

      void this.syncCustomerAsaasSafe(novoTitular.id);
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
    const titular = await this.prisma.titular.update({ where: { id: Number(id) }, data });
    void this.syncCustomerAsaasSafe(titular.id);
    return titular;
  }

  async delete(id: number): Promise<TitularType> {
    return this.prisma.titular.delete({ where: { id: Number(id) } });
  }

  async listarAssinaturas(titularId: number): Promise<AssinaturaDigitalType[]> {
    return (this.prisma as any).assinaturaDigital.findMany({
      where: { titularId },
      orderBy: { tipo: 'asc' },
    });
  }

  async salvarAssinaturaDigital(
    titularId: number,
    tipo: AssinaturaTipo,
    assinaturaBase64: string,
  ): Promise<AssinaturaDigitalType> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: { id: true },
    });
    if (!titular) {
      throw new Error('Titular não encontrado.');
    }

    if (!ASSINATURA_TIPOS.includes(tipo)) {
      throw new Error('Tipo de assinatura inválido.');
    }

    const { buffer, mimetype } = this.parseBase64Image(assinaturaBase64);
    const filename = `assinatura-${tipo.toLowerCase()}-${Date.now()}.png`;
    const uploadInfo = await this.uploadAssinaturaArquivo(buffer, mimetype, filename);

    return (this.prisma as any).assinaturaDigital.upsert({
      where: {
        titularId_tipo: {
          titularId,
          tipo,
        },
      },
      update: {
        arquivoId: uploadInfo.arquivoId,
        arquivoUrl: uploadInfo.arquivoUrl,
        filename: uploadInfo.filename,
        mimetype: uploadInfo.mimetype,
        size: uploadInfo.size,
      },
      create: {
        titularId,
        tipo,
        arquivoId: uploadInfo.arquivoId,
        arquivoUrl: uploadInfo.arquivoUrl,
        filename: uploadInfo.filename,
        mimetype: uploadInfo.mimetype,
        size: uploadInfo.size,
      },
    });
  }

  async baixarAssinaturaDigital(
    titularId: number,
    assinaturaId: number,
  ): Promise<{ buffer: Buffer; mimetype: string; filename: string }> {
    const assinatura = await (this.prisma as any).assinaturaDigital.findUnique({
      where: { id: assinaturaId },
    });

    if (!assinatura || assinatura.titularId !== titularId) {
      const err: any = new Error('Assinatura não encontrada para este titular.');
      err.status = 404;
      throw err;
    }

    const token = this.getFilesApiToken();
    if (!token) {
      throw new Error('Token da Files API não configurado para este tenant.');
    }

    const baseUrl = FILES_API_BASE_URL?.replace(/\/$/, '');
    const requestUrl = assinatura.arquivoId && baseUrl
      ? `${baseUrl}/file/${assinatura.arquivoId}/download`
      : assinatura.arquivoUrl;

    if (!requestUrl) {
      throw new Error('URL do arquivo da assinatura não está configurada.');
    }

    const response = await fetch(requestUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Falha ao baixar assinatura do armazenamento externo: ${response.status} ${message}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      mimetype:
        assinatura.mimetype ||
        response.headers.get('content-type') ||
        'application/octet-stream',
      filename:
        assinatura.filename ||
        `assinatura-${assinatura.tipo.toLowerCase().replace(/_/g, '-')}.png`,
    };
  }

  private parseBase64Image(dataUrl: string) {
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      throw Object.assign(new Error('Formato de assinatura inválido.'), { status: 400 });
    }
    const mimetype = matches?.[1] ?? 'image/png';
    const payload = matches?.[2] ?? dataUrl;
    if (!ASSINATURA_ALLOWED_MIME.includes(mimetype)) {
      throw Object.assign(new Error('Tipo de arquivo de assinatura não permitido.'), { status: 400 });
    }
    const sizeBytes = Math.floor((payload.length * 3) / 4);
    if (sizeBytes > ASSINATURA_MAX_BYTES) {
      throw Object.assign(new Error('Arquivo de assinatura excede o limite de 5MB.'), { status: 400 });
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(payload)) {
      throw Object.assign(new Error('Assinatura em base64 inválida.'), { status: 400 });
    }
    const buffer = Buffer.from(payload, 'base64');
    return { buffer, mimetype };
  }

  private async uploadAssinaturaArquivo(
    buffer: Buffer,
    mimetype: string,
    filename: string,
  ) {
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
      throw new Error(
        `Falha ao enviar assinatura para armazenamento externo: ${response.status} ${message}`,
      );
    }

    const payload = await response.json();
    const arquivoId = payload.id;
    const arquivoUrl =
      payload.path ||
      `${FILES_API_BASE_URL}/file/${arquivoId}/download`;

    return {
      arquivoId: String(arquivoId),
      arquivoUrl: arquivoUrl,
      filename: payload.filename || filename,
      mimetype: payload.mimetype || mimetype,
      size: payload.size ?? buffer.length,
    };
  }

  private getFilesApiToken(): string | null {
    if (!this.tenantId) return process.env.FILES_API_TOKEN || null;
    const normalized = this.tenantId.toUpperCase();
    const envKey = `FILES_API_TOKEN_${normalized}`;
    return process.env[envKey] || process.env.FILES_API_TOKEN || null;
  }

  private async syncCustomerAsaasSafe(titularId: number) {
    try {
      await this.asaasIntegration.ensureCustomerForTitular(titularId);
    } catch (error: any) {
      this.logger.warn('Falha ao sincronizar titular com Asaas', {
        error: error?.message,
        titularId,
      });
    }
  }
}
