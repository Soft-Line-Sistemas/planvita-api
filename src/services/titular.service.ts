import { Prisma, getPrismaForTenant } from '../utils/prisma';
import { CadastroTitularRequest } from '../types/titular';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Buffer } from 'buffer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { AsaasIntegrationService } from './asaas-integration.service';
import Logger from '../utils/logger';
import { TitularPricingService } from './titular-pricing.service';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

const TITULAR_EXPORT_INCLUDE = {
  plano: true,
  dependentes: true,
  corresponsaveis: true,
  vendedor: true,
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
const FOTO_PERFIL_TIPO_DOCUMENTO = 'FOTO_PERFIL';
const FOTO_PERFIL_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];
const FOTO_PERFIL_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_DIAS_SUSPENSAO = 90;
const MAX_DEPENDENTES_POR_TITULAR = 8;
const execFileAsync = promisify(execFile);
const CONTRATO_TEMPLATE_CANDIDATES = [
  process.env.CONTRATO_TEMPLATE_DOCX_PATH,
  path.resolve(process.cwd(), 'public/docs/contrato.docx'),
  path.resolve(process.cwd(), 'docs/contrato.docx'),
  path.resolve(process.cwd(), 'src/assets/contrato.docx'),
  path.resolve(process.cwd(), 'dist/public/docs/contrato.docx'),
  path.resolve(process.cwd(), 'dist/assets/contrato.docx'),
  path.resolve(process.cwd(), '../frontend/public/docs/contrato.docx'),
  path.resolve(process.cwd(), 'frontend/public/docs/contrato.docx'),
  path.resolve(process.cwd(), '../dist/public/docs/contrato.docx'),
  path.resolve(__dirname, '../../public/docs/contrato.docx'),
  path.resolve(__dirname, '../../docs/contrato.docx'),
  path.resolve(__dirname, '../public/docs/contrato.docx'),
  path.resolve(__dirname, '../assets/contrato.docx'),
].filter(Boolean) as string[];
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

export type FotoPerfilPayload = {
  imageBase64: string;
  filename?: string;
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
};

export type FotoPerfilResponse = {
  id: number;
  titularId: number;
  arquivoUrl: string;
  dataUpload: Date;
};

export class TitularService {
  private prisma;
  private asaasIntegration: AsaasIntegrationService;
  private pricingService: TitularPricingService;
  private logger: Logger;

  constructor(private tenantId: string) {
    if (!tenantId) {
      throw new Error('Tenant ID must be provided');
    }

    this.prisma = getPrismaForTenant(tenantId);
    this.asaasIntegration = new AsaasIntegrationService(tenantId);
    this.pricingService = new TitularPricingService(tenantId);
    this.logger = new Logger({ service: 'TitularService', tenantId });
  }

  private async obterLimiteBeneficiarios(): Promise<number | null> {
    const regras = await this.prisma.businessRules.findFirst({
      where: { tenantId: this.tenantId },
      select: { limiteBeneficiarios: true },
    });

    const limiteConfigurado = regras?.limiteBeneficiarios ?? null;
    if (!limiteConfigurado || limiteConfigurado <= 0) return MAX_DEPENDENTES_POR_TITULAR;
    return Math.min(limiteConfigurado, MAX_DEPENDENTES_POR_TITULAR);
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

  private calcularIdade(dataNascimento: string | Date): number | null {
    let ano: number;
    let mes: number;
    let dia: number;

    if (dataNascimento instanceof Date) {
      if (Number.isNaN(dataNascimento.getTime())) return null;
      ano = dataNascimento.getFullYear();
      mes = dataNascimento.getMonth() + 1;
      dia = dataNascimento.getDate();
    } else {
      const normalized = String(dataNascimento ?? '').trim();
      if (!normalized) return null;

      const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        ano = Number(match[1]);
        mes = Number(match[2]);
        dia = Number(match[3]);
      } else {
        const parsed = new Date(normalized);
        if (Number.isNaN(parsed.getTime())) return null;
        ano = parsed.getFullYear();
        mes = parsed.getMonth() + 1;
        dia = parsed.getDate();
      }
    }

    const hoje = new Date();
    let idade = hoje.getFullYear() - ano;
    const deltaMes = hoje.getMonth() + 1 - mes;
    if (deltaMes < 0 || (deltaMes === 0 && hoje.getDate() < dia)) {
      idade -= 1;
    }
    return idade;
  }

  private validarMaioridadeCorresponsavel(
    usarMesmosDados: boolean,
    dataNascimentoTitular: string,
    dataNascimentoCorresponsavel?: string,
  ) {
    const referencia = usarMesmosDados ? dataNascimentoTitular : dataNascimentoCorresponsavel;
    if (!referencia) {
      const err: any = new Error('Data de nascimento do corresponsável é obrigatória.');
      err.status = 400;
      err.code = 'CORRESPONSAVEL_DATA_NASCIMENTO_OBRIGATORIA';
      throw err;
    }

    const idade = this.calcularIdade(referencia);
    if (idade === null) {
      const err: any = new Error('Data de nascimento do corresponsável inválida.');
      err.status = 400;
      err.code = 'CORRESPONSAVEL_DATA_NASCIMENTO_INVALIDA';
      throw err;
    }

    if (idade < 18) {
      const err: any = new Error('Corresponsável deve ser maior de idade (18+).');
      err.status = 400;
      err.code = 'CORRESPONSAVEL_MENOR_IDADE';
      err.meta = { idadeMinima: 18, idadeInformada: idade };
      throw err;
    }
  }

  private validarCpfUnicoNoCadastro(data: CadastroTitularRequest) {
    const titularCpf = String(data?.step1?.cpf ?? '').replace(/\D/g, '');
    const responsavelCpf = String(data?.step3?.cpf ?? '').replace(/\D/g, '');
    const usarMesmosDados = Boolean(data?.step3?.usarMesmosDados);
    const dependentes = Array.isArray(data?.dependentes) ? data.dependentes : [];

    const porCpf = new Map<string, string[]>();
    const registrar = (cpfDigits: string, origem: string) => {
      if (cpfDigits.length !== 11) return;
      const atual = porCpf.get(cpfDigits) ?? [];
      atual.push(origem);
      porCpf.set(cpfDigits, atual);
    };

    registrar(titularCpf, 'titular.cpf');
    if (!usarMesmosDados) {
      registrar(responsavelCpf, 'responsavelFinanceiro.cpf');
    }
    dependentes.forEach((dep, index) => {
      const cpfDependente = String(dep?.cpf ?? '').replace(/\D/g, '');
      registrar(cpfDependente, `dependentes[${index}].cpf`);
    });

    const duplicados = Array.from(porCpf.entries())
      .filter(([, origens]) => origens.length > 1)
      .map(([cpf, origens]) => ({ cpf, origens }));

    if (!duplicados.length) return;

    const err: any = new Error(
      'CPF já informado no cadastro. Não é permitido repetir CPF entre titular, responsável financeiro e dependentes.',
    );
    err.status = 400;
    err.code = 'CPF_DUPLICADO_NO_CADASTRO';
    err.meta = { duplicados };
    throw err;
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

  async getAllForExport(params?: {
    search?: string;
    status?: string;
    plano?: string;
  }) {
    const { search, status, plano } = params || {};
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

    if (status && status !== 'todos') {
      where.statusPlano = status;
    }

    if (plano && plano !== 'todos') {
      where.plano = { nome: plano };
    }

    return this.prisma.titular.findMany({
      where,
      include: TITULAR_EXPORT_INCLUDE as any,
      orderBy: { nome: 'asc' },
    });
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
    const valorMensal = await this.pricingService.recalcularFinanceiroTitular(titular.id);
    void this.syncCustomerAsaasSafe(titular.id);
    void this.syncSubscriptionAsaasSafe(titular.id, titular.nome, valorMensal);
    return titular;
  }

  async createFull(data: CadastroTitularRequest) {
    const { step1, step2, step3, dependentes, step5 } = data;

    // --- Validações básicas ---
    if (!step1.email || !step1.cpf || !step1.situacaoConjugal || !step1.profissao) {
      throw Object.assign(
        new Error('Email, CPF, situação conjugal e profissão são obrigatórios'),
        { status: 400 },
      );
    }

    const planoIdSelecionado = Number(step5?.planoId);
    if (!Number.isFinite(planoIdSelecionado) || planoIdSelecionado <= 0) {
      const err: any = new Error('Seleção de plano é obrigatória para concluir o cadastro.');
      err.status = 400;
      err.code = 'PLANO_OBRIGATORIO';
      throw err;
    }
    const billingTypeRaw = String(step5?.billingType ?? 'PIX').toUpperCase();
    const allowedBillingTypes = ['PIX', 'BOLETO', 'CREDIT_CARD'] as const;
    const billingType = allowedBillingTypes.includes(
      billingTypeRaw as (typeof allowedBillingTypes)[number],
    )
      ? (billingTypeRaw as 'PIX' | 'BOLETO' | 'CREDIT_CARD')
      : 'PIX';

    // Normaliza email e CPF
    const email = step1.email.trim().toLowerCase();
    const cpf = step1.cpf.replace(/\D/g, '');
    const situacaoConjugal = String(step1.situacaoConjugal ?? '').trim();
    const profissao = String(step1.profissao ?? '').trim();
    const sexo = String(step1.sexo ?? '').trim();
    const rg = String(step1.rg ?? '').trim() || null;
    const naturalidade = String(step1.naturalidade ?? '').trim();
    const pontoReferenciaTitular = String(step2?.pontoReferencia ?? '').trim();

    if (!situacaoConjugal || !profissao || !sexo || !naturalidade) {
      throw Object.assign(
        new Error('Sexo, Naturalidade, Situação conjugal e Profissão são obrigatórios'),
        { status: 400 },
      );
    }

    this.validarCpfUnicoNoCadastro(data);

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
    this.validarMaioridadeCorresponsavel(
      usarMesmosDados,
      step1.dataNascimento,
      step3.dataNascimento,
    );
    const corresponsavelData = usarMesmosDados
      ? {
          nome: step1.nomeCompleto,
          email: email,
          telefone: step1.telefone,
          relacionamento: 'Titular',
          situacaoConjugal,
          profissao,
          sexo,
          rg,
          naturalidade,
          cep: step2.cep,
          uf: step2.uf,
          cidade: step2.cidade,
          bairro: step2.bairro,
          logradouro: step2.logradouro,
          complemento: step2.complemento,
          numero: step2.numero,
          pontoReferencia: pontoReferenciaTitular,
        }
      : {
          nome: step3.nomeCompleto || 'Sem nome',
          email: (step3.email || '').trim().toLowerCase(),
          telefone: step3.telefone,
          relacionamento: step3.parentesco || 'Outro',
          situacaoConjugal: String(step3.situacaoConjugal ?? '').trim(),
          profissao: String(step3.profissao ?? '').trim(),
          sexo: String(step3.sexo ?? '').trim(),
          rg: String(step3.rg ?? '').trim() || null,
          naturalidade: String(step3.naturalidade ?? '').trim(),
          cep: String(step3.cep ?? '').trim(),
          uf: String(step3.uf ?? '').trim(),
          cidade: String(step3.cidade ?? '').trim(),
          bairro: String(step3.bairro ?? '').trim(),
          logradouro: String(step3.logradouro ?? '').trim(),
          complemento: String(step3.complemento ?? '').trim(),
          numero: String(step3.numero ?? '').trim(),
          pontoReferencia: String(step3.pontoReferencia ?? '').trim(),
        };

    if (!usarMesmosDados) {
      if (
        !corresponsavelData.situacaoConjugal ||
        !corresponsavelData.profissao ||
        !corresponsavelData.sexo ||
        !corresponsavelData.naturalidade
      ) {
        const err: any = new Error('Sexo, Naturalidade, Situação conjugal e profissão do responsável financeiro são obrigatórios.');
        err.status = 400;
        err.code = 'CORRESPONSAVEL_CAMPOS_OBRIGATORIOS';
        throw err;
      }
    }

    // --- Monta dependentes ---
    const dependentesData = dependentes?.map((dep) => ({
      nome: dep.nome,
      tipoDependente: dep.parentesco || 'Outro',
      dataNascimento: dep.dataNascimento
        ? new Date(dep.dataNascimento)
        : new Date(),
      excluirCobrancaAdicional: false,
    }));
    await this.validarLimiteBeneficiariosCadastro(dependentesData?.length ?? 0);
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
            situacaoConjugal,
            profissao,
            sexo,
            rg,
            naturalidade,
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
            pontoReferencia: pontoReferenciaTitular,
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
      await this.pricingService.recalcularDependentesDoTitular(novoTitular.id);
      const valorMensal = await this.pricingService.recalcularFinanceiroTitular(novoTitular.id);
      void this.syncSubscriptionAsaasSafe(
        novoTitular.id,
        novoTitular.nome,
        valorMensal,
        billingType,
      );
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
    await this.pricingService.recalcularDependentesDoTitular(titular.id);
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

  async baixarContratoComAssinaturas(
    titularId: number,
    format: 'docx' | 'pdf' = 'pdf',
  ): Promise<{ buffer: Buffer; mimetype: string; filename: string }> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: { id: true, nome: true },
    });
    if (!titular) {
      const err: any = new Error('Titular não encontrado.');
      err.status = 404;
      throw err;
    }

    const templatePath = this.resolveContratoTemplatePath();
    const templateBuffer = fs.readFileSync(templatePath);
    const fichaAdesaoBuffer = await this.buildFichaAdesaoPageDocxBuffer(titularId);
    const assinaturaPageBuffer = await this.buildAssinaturasPageDocxBuffer(titularId);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DocxMerger = require('docx-merger');
    const merger = new DocxMerger(
      { pageBreak: true },
      [templateBuffer, fichaAdesaoBuffer, assinaturaPageBuffer],
    );
    const mergedBuffer = await new Promise<Buffer>((resolve) => {
      merger.save('nodebuffer', (data: Buffer) => resolve(data));
    });

    const safeName = String(titular.nome || 'titular')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase();

    const assinaturas = await this.listarAssinaturas(titularId);
    const hasAnyAssinatura = assinaturas.length > 0;
    const sufixoStatus = hasAnyAssinatura ? 'assinado' : 'pendente-assinatura';
    const filenameBase = `contrato-${safeName || 'cliente'}-${sufixoStatus}`;
    if (format === 'docx') {
      return {
        buffer: mergedBuffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: `${filenameBase}.docx`,
      };
    }

    const basePdfBuffer = await this.convertDocxBufferToPdf(templateBuffer, `${filenameBase}-base`);
    const fichaAdesaoPdfBuffer = await this.convertDocxBufferToPdf(
      fichaAdesaoBuffer,
      `${filenameBase}-ficha-adesao`,
    );
    const assinaturasPdfBuffer = await this.buildAssinaturasPagePdfBuffer(titularId);
    const pdfBuffer = await this.mergePdfBuffers([
      basePdfBuffer,
      fichaAdesaoPdfBuffer,
      assinaturasPdfBuffer,
    ]);
    return {
      buffer: pdfBuffer,
      mimetype: 'application/pdf',
      filename: `${filenameBase}.pdf`,
    };
  }

  async salvarFotoPerfil(
    titularId: number,
    payload: FotoPerfilPayload,
  ): Promise<FotoPerfilResponse> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      select: { id: true },
    });
    if (!titular) {
      const err: any = new Error('Titular não encontrado.');
      err.status = 404;
      throw err;
    }

    const { buffer, mimetype } = this.parseBase64ImageCustom(
      payload.imageBase64,
      FOTO_PERFIL_ALLOWED_MIME,
      FOTO_PERFIL_MAX_BYTES,
      payload.mimeType,
    );
    const filename = this.normalizeFilename(payload.filename, mimetype, 'foto-perfil');
    const uploadInfo = await this.uploadAssinaturaArquivo(buffer, mimetype, filename);

    const documentoAtual = await this.prisma.documento.findFirst({
      where: { titularId, tipoDocumento: FOTO_PERFIL_TIPO_DOCUMENTO },
      orderBy: { dataUpload: 'desc' },
      select: { id: true },
    });

    if (documentoAtual) {
      return this.prisma.documento.update({
        where: { id: documentoAtual.id },
        data: {
          arquivoUrl: uploadInfo.arquivoUrl,
          dataUpload: new Date(),
        },
        select: {
          id: true,
          titularId: true,
          arquivoUrl: true,
          dataUpload: true,
        },
      });
    }

    return this.prisma.documento.create({
      data: {
        titularId,
        tipoDocumento: FOTO_PERFIL_TIPO_DOCUMENTO,
        arquivoUrl: uploadInfo.arquivoUrl,
        dataUpload: new Date(),
      },
      select: {
        id: true,
        titularId: true,
        arquivoUrl: true,
        dataUpload: true,
      },
    });
  }

  async removerFotoPerfil(titularId: number): Promise<void> {
    await this.prisma.documento.deleteMany({
      where: {
        titularId,
        tipoDocumento: FOTO_PERFIL_TIPO_DOCUMENTO,
      },
    });
  }

  async buscarFotoPerfil(titularId: number): Promise<FotoPerfilResponse | null> {
    return this.prisma.documento.findFirst({
      where: {
        titularId,
        tipoDocumento: FOTO_PERFIL_TIPO_DOCUMENTO,
      },
      orderBy: { dataUpload: 'desc' },
      select: {
        id: true,
        titularId: true,
        arquivoUrl: true,
        dataUpload: true,
      },
    });
  }

  async baixarFotoPerfil(titularId: number): Promise<{ buffer: Buffer; mimetype: string }> {
    const foto = await this.buscarFotoPerfil(titularId);
    if (!foto) {
      const err: any = new Error('Foto de perfil não encontrada.');
      err.status = 404;
      throw err;
    }

    const token = this.getFilesApiToken();
    if (!token) {
      throw new Error('Token da Files API não configurado para este tenant.');
    }

    const response = await fetch(foto.arquivoUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Falha ao baixar foto do armazenamento externo: ${response.status} ${message}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();

    return {
      buffer: Buffer.from(arrayBuffer),
      mimetype: response.headers.get('content-type') || 'image/jpeg',
    };
  }

  private parseBase64Image(input: string) {
    return this.parseBase64ImageWithConstraints(
      input,
      ASSINATURA_ALLOWED_MIME,
      ASSINATURA_MAX_BYTES,
    );
  }

  private resolveContratoTemplatePath(): string {
    for (const candidate of CONTRATO_TEMPLATE_CANDIDATES) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
    const candidates = CONTRATO_TEMPLATE_CANDIDATES.join(' | ');
    throw new Error(
      `Template de contrato .docx não encontrado. Configure CONTRATO_TEMPLATE_DOCX_PATH ou disponibilize o arquivo em um dos caminhos esperados. Candidatos verificados: ${candidates}`,
    );
  }

  private async buildAssinaturasPageDocxBuffer(titularId: number): Promise<Buffer> {
    const assinaturas = await this.listarAssinaturas(titularId);
    const mapByTipo = new Map<string, AssinaturaDigitalType>();
    for (const assinatura of assinaturas) {
      mapByTipo.set(assinatura.tipo, assinatura);
    }

    const sections = [
      { tipo: 'TITULAR_ASSINATURA_1', titulo: 'Titular - Assinatura 1' },
      { tipo: 'TITULAR_ASSINATURA_2', titulo: 'Titular - Assinatura 2' },
      { tipo: 'CORRESPONSAVEL_ASSINATURA_1', titulo: 'Corresponsável financeiro - 1' },
      { tipo: 'CORRESPONSAVEL_ASSINATURA_2', titulo: 'Corresponsável financeiro - 2' },
    ] as const;

    const children: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: 'Assinaturas', bold: true })],
      }),
      new Paragraph({ children: [new TextRun('')] }),
    ];

    for (const item of sections) {
      const assinatura = mapByTipo.get(item.tipo);
      children.push(
        new Paragraph({
          children: [new TextRun({ text: item.titulo, bold: true, size: 24 })],
        }),
      );

      if (assinatura) {
        try {
          const { buffer, mimetype } = await this.baixarAssinaturaDigital(titularId, assinatura.id);
          const imageType = mimetype.includes('png') ? 'png' : 'jpg';
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: buffer,
                  type: imageType,
                  transformation: { width: 260, height: 90 },
                }),
              ],
            }),
          );
        } catch (error) {
          this.logger.warn('Falha ao carregar assinatura para contrato', {
            titularId,
            assinaturaId: assinatura.id,
            tipo: assinatura.tipo,
            error: (error as any)?.message,
          });
          children.push(new Paragraph({ children: [new TextRun('Pendente assinatura')] }));
        }
      } else {
        children.push(new Paragraph({ children: [new TextRun('Pendente assinatura')] }));
      }

      if (assinatura?.createdAt) {
        const dataAssinatura = this.formatDatePtBr(assinatura.createdAt);
        children.push(
          new Paragraph({
            children: [new TextRun(`Assinado em ${dataAssinatura}`)],
          }),
        );
      }
      children.push(new Paragraph({ children: [new TextRun('')] }));
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children,
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  private formatDatePtBr(value: Date | string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${day}/${month}/${year}`;
  }

  private async buildFichaAdesaoPageDocxBuffer(titularId: number): Promise<Buffer> {
    const titular = await this.prisma.titular.findUnique({
      where: { id: titularId },
      include: {
        plano: true,
        dependentes: true,
        corresponsaveis: true,
        vendedor: true,
      },
    });

    if (!titular) {
      const err: any = new Error('Titular não encontrado.');
      err.status = 404;
      throw err;
    }

    const corresponsavel = titular.corresponsaveis?.[0] ?? null;
    const line = (label: string, value: string | number | null | undefined) =>
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: `${label}: `, bold: true }),
          new TextRun(String(value ?? 'Não informado')),
        ],
      });

    const blockTitle = (text: string) =>
      new Paragraph({
        spacing: { before: 220, after: 120 },
        children: [new TextRun({ text, bold: true, size: 24 })],
      });

    const children: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'FICHA DE ADESAO', bold: true })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 280 },
        children: [new TextRun({ text: 'Dados cadastrais e detalhamento da adesao ao plano', italics: true })],
      }),

      blockTitle('1. Titular'),
      line('Nome', titular.nome),
      line('CPF', titular.cpf),
      line('RG', titular.rg),
      line('Data de nascimento', this.formatDatePtBr(titular.dataNascimento)),
      line('Email', titular.email),
      line('Telefone', titular.telefone),
      line('Profissao', titular.profissao),
      line('Situacao conjugal', titular.situacaoConjugal),
      line('Naturalidade', titular.naturalidade),

      blockTitle('2. Endereco do titular'),
      line('CEP', titular.cep),
      line('Logradouro', titular.logradouro),
      line('Numero', titular.numero),
      line('Complemento', titular.complemento),
      line('Bairro', titular.bairro),
      line('Cidade/UF', [titular.cidade, titular.uf].filter(Boolean).join('/')),
      line('Ponto de referencia', titular.pontoReferencia),

      blockTitle('3. Plano contratado'),
      line('Plano', titular.plano?.nome),
      line('Valor mensal', titular.plano?.valorMensal != null ? `R$ ${titular.plano.valorMensal.toFixed(2)}` : null),
      line('Carencia (dias)', titular.plano?.carenciaDias),
      line('Vigencia (meses)', titular.plano?.vigenciaMeses),
      line('Cobertura maxima', titular.plano?.coberturaMaxima),
      line('Assistencia funeral', titular.plano?.assistenciaFuneral),
      line('Auxilio cemiterio', titular.plano?.auxilioCemiterio),

      blockTitle('4. Responsavel financeiro'),
      line('Nome', corresponsavel?.nome),
      line('Email', corresponsavel?.email),
      line('Telefone', corresponsavel?.telefone),
      line('Relacionamento', corresponsavel?.relacionamento),
      line('RG', corresponsavel?.rg),

      blockTitle(`5. Dependentes (${titular.dependentes?.length ?? 0})`),
    ];

    if (!titular.dependentes?.length) {
      children.push(line('Lista', 'Nenhum dependente cadastrado'));
    } else {
      titular.dependentes.forEach((dep, index) => {
        children.push(
          new Paragraph({
            spacing: { before: 140, after: 80 },
            children: [new TextRun({ text: `${index + 1}. ${dep.nome}`, bold: true })],
          }),
        );
        children.push(line('Parentesco', dep.tipoDependente));
        children.push(line('Data de nascimento', this.formatDatePtBr(dep.dataNascimento)));
      });
    }

    children.push(
      blockTitle('6. Informacoes comerciais'),
      line('Vendedor', titular.vendedor?.nome),
      line('Data de contratacao', this.formatDatePtBr(titular.dataContratacao)),
      line('Status do plano', titular.statusPlano),
      new Paragraph({ children: [new TextRun('')] }),
      new Paragraph({
        spacing: { before: 280 },
        children: [
          new TextRun(
            'Declaro que os dados acima refletem as informacoes apresentadas no detalhe do contrato e no cadastro do titular.',
          ),
        ],
      }),
    );

    const doc = new Document({
      sections: [
        {
          properties: {},
          children,
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  private async convertDocxBufferToPdf(docxBuffer: Buffer, filenameBase: string): Promise<Buffer> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planvita-contrato-'));
    const inputPath = path.join(tempDir, `${filenameBase}.docx`);
    const outputPath = path.join(tempDir, `${filenameBase}.pdf`);

    try {
      fs.writeFileSync(inputPath, docxBuffer);

      const binaries = [
        process.env.LIBREOFFICE_BINARY,
        'soffice',
        'libreoffice',
      ].filter(Boolean) as string[];
      let converted = false;
      for (const bin of binaries) {
        try {
          await execFileAsync(bin, [
            '--headless',
            '--nologo',
            '--nolockcheck',
            '--convert-to',
            'pdf:writer_pdf_Export',
            '--outdir',
            tempDir,
            inputPath,
          ]);
          converted = true;
          break;
        } catch (error: any) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }

      if (!converted) {
        const err: any = new Error(
          'Conversao DOCX->PDF indisponivel: LibreOffice nao encontrado (soffice/libreoffice). Instale LibreOffice no servidor ou configure LIBREOFFICE_BINARY com o caminho do executavel.',
        );
        err.code = 'DOCX_PDF_BINARY_NOT_FOUND';
        throw err;
      }

      const generatedFiles = fs.readdirSync(tempDir).filter((file) => file.toLowerCase().endsWith('.pdf'));
      const resolvedOutputPath = fs.existsSync(outputPath)
        ? outputPath
        : generatedFiles.length > 0
          ? path.join(tempDir, generatedFiles[0])
          : null;

      if (!resolvedOutputPath) throw new Error('Conversão para PDF não gerou arquivo de saída.');

      return fs.readFileSync(resolvedOutputPath);
    } catch (error: any) {
      throw new Error(`Falha ao converter contrato para PDF: ${error?.message || error}`);
    } finally {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // noop
      }
    }
  }

  private async buildAssinaturasPagePdfBuffer(titularId: number): Promise<Buffer> {
    const assinaturas = await this.listarAssinaturas(titularId);
    const mapByTipo = new Map<string, AssinaturaDigitalType>();
    for (const assinatura of assinaturas) mapByTipo.set(assinatura.tipo, assinatura);

    const sections = [
      { tipo: 'TITULAR_ASSINATURA_1', titulo: 'Titular - Assinatura 1' },
      { tipo: 'TITULAR_ASSINATURA_2', titulo: 'Titular - Assinatura 2' },
      { tipo: 'CORRESPONSAVEL_ASSINATURA_1', titulo: 'Corresponsavel financeiro - 1' },
      { tipo: 'CORRESPONSAVEL_ASSINATURA_2', titulo: 'Corresponsavel financeiro - 2' },
    ] as const;

    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let y = 800;
    page.drawText('Assinaturas', {
      x: 50,
      y,
      size: 16,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    y -= 35;

    for (const item of sections) {
      const assinatura = mapByTipo.get(item.tipo);
      page.drawText(item.titulo, {
        x: 50,
        y,
        size: 12,
        font: fontBold,
      });
      y -= 20;

      if (assinatura) {
        try {
          const { buffer, mimetype } = await this.baixarAssinaturaDigital(titularId, assinatura.id);
          const image = mimetype.includes('png')
            ? await pdf.embedPng(buffer)
            : await pdf.embedJpg(buffer);
          const targetWidth = 220;
          const ratio = targetWidth / image.width;
          const targetHeight = Math.min(image.height * ratio, 90);
          page.drawImage(image, { x: 50, y: y - targetHeight + 5, width: targetWidth, height: targetHeight });
          y -= 90;
        } catch {
          page.drawText('Pendente assinatura', { x: 50, y, size: 11, font });
          y -= 20;
        }
      } else {
        page.drawText('Pendente assinatura', { x: 50, y, size: 11, font });
        y -= 20;
      }

      if (assinatura?.createdAt) {
        const dataAssinatura = this.formatDatePtBr(assinatura.createdAt);
        page.drawText(`Assinado em ${dataAssinatura}`, {
          x: 50,
          y,
          size: 11,
          font,
        });
        y -= 30;
      } else {
        y -= 15;
      }
    }

    return Buffer.from(await pdf.save());
  }

  private async mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
    const mergedPdf = await PDFDocument.create();
    for (const buf of buffers) {
      const src = await PDFDocument.load(buf);
      const copied = await mergedPdf.copyPages(src, src.getPageIndices());
      for (const page of copied) mergedPdf.addPage(page);
    }
    return Buffer.from(await mergedPdf.save());
  }

  private parseBase64ImageWithConstraints(
    input: string,
    allowedMimeTypes: readonly string[],
    maxBytes: number,
    fallbackMimeType?: string,
  ) {
    const trimmed = (input || '').trim();
    if (!trimmed) {
      throw Object.assign(new Error('Formato de assinatura inválido.'), { status: 400 });
    }

    const matches = trimmed.match(/^data:(.+);base64,(.+)$/);
    const mimetype = matches?.[1] ?? fallbackMimeType ?? 'image/png';
    const rawPayload = matches?.[2] ?? trimmed;
    const payload = rawPayload.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');

    if (!allowedMimeTypes.includes(mimetype)) {
      throw Object.assign(new Error('Tipo de arquivo de assinatura não permitido.'), { status: 400 });
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(payload)) {
      throw Object.assign(new Error('Assinatura em base64 inválida.'), { status: 400 });
    }

    const buffer = Buffer.from(payload, 'base64');
    if (!buffer.length) {
      throw Object.assign(new Error('Assinatura em base64 inválida.'), { status: 400 });
    }
    if (buffer.length > maxBytes) {
      throw Object.assign(new Error('Arquivo de assinatura excede o limite de 5MB.'), { status: 400 });
    }

    return { buffer, mimetype };
  }

  private parseBase64ImageCustom(
    input: string,
    allowedMimeTypes: readonly string[],
    maxBytes: number,
    fallbackMimeType?: string,
  ) {
    return this.parseBase64ImageWithConstraints(
      input,
      allowedMimeTypes,
      maxBytes,
      fallbackMimeType,
    );
  }

  private normalizeFilename(
    filenameRaw: string | undefined,
    mimeType: string,
    fallbackBaseName: string,
  ): string {
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

  private async syncSubscriptionAsaasSafe(
    titularId: number,
    titularNome: string,
    valorMensal: number,
    billingType?: 'PIX' | 'BOLETO' | 'CREDIT_CARD',
  ) {
    try {
      await this.asaasIntegration.ensureMonthlySubscriptionForTitular({
        titularId,
        valorMensal,
        descricao: `Mensalidade Plano - ${titularNome}`,
        billingType,
      });
    } catch (error: any) {
      this.logger.warn('Falha ao sincronizar assinatura mensal com Asaas', {
        error: error?.message,
        titularId,
      });
    }
  }
}
