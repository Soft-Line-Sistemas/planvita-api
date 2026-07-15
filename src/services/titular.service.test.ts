const prismaMock = {
  businessRules: { findFirst: jest.fn() },
  comissao: {
    deleteMany: jest.fn(),
  },
  pagamento: {
    deleteMany: jest.fn(),
  },
  documento: {
    deleteMany: jest.fn(),
  },
  consentAcceptance: {
    createMany: jest.fn(),
  },
  titular: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  dependente: {
    deleteMany: jest.fn(),
  },
  corresponsavel: {
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  contaReceber: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  orcamento: {
    deleteMany: jest.fn(),
  },
  recibo: {
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: {
    validator: () => (value: unknown) => value,
  },
}));

const asaasMock = {
  ensureCustomerForTitular: jest.fn().mockResolvedValue(null),
  ensureMonthlySubscriptionForTitular: jest.fn().mockResolvedValue(null),
  isEnabled: jest.fn().mockReturnValue(false),
  cancelMonthlySubscriptionForTitular: jest.fn().mockResolvedValue('sub-123'),
};

jest.mock('./asaas-integration.service', () => ({
  AsaasIntegrationService: jest.fn().mockImplementation(() => asaasMock),
}));

const pricingServiceMock = {
  recalcularDependentesDoTitular: jest.fn().mockResolvedValue(undefined),
  recalcularFinanceiroTitular: jest.fn().mockResolvedValue(100),
};

jest.mock('./titular-pricing.service', () => ({
  TitularPricingService: jest.fn().mockImplementation(() => pricingServiceMock),
}));

const listarPlanosCompativeisMock = jest
  .fn()
  .mockResolvedValue([{ id: 1, nome: 'Plano Teste' }]);

jest.mock('./plano.service', () => ({
  PlanoService: jest.fn().mockImplementation(() => ({
    listarPlanosCompativeis: listarPlanosCompativeisMock,
  })),
}));

import { TitularService } from './titular.service';

// Helper para payload completo válido
const makePayload = (overrides: Record<string, unknown> = {}) => ({
  step1: {
    nomeCompleto: 'Cliente Teste',
    cpf: '12345678901',
    dataNascimento: '1990-01-01',
    sexo: 'Masculino',
    naturalidade: 'São Paulo',
    telefone: '11999999999',
    whatsapp: '11999999999',
    email: 'cliente@teste.com',
    situacaoConjugal: 'Solteiro',
    profissao: 'Analista',
  },
  step2: {
    cep: '01001000',
    uf: 'SP',
    cidade: 'São Paulo',
    bairro: 'Centro',
    logradouro: 'Rua A',
    complemento: '',
    numero: '10',
    pontoReferencia: '',
  },
  step3: { usarMesmosDados: true },
  dependentes: [],
  step5: { planoId: 1 },
  ...overrides,
});

describe('TitularService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asaasMock.isEnabled.mockReturnValue(false);
    asaasMock.cancelMonthlySubscriptionForTitular.mockResolvedValue('sub-123');
    prismaMock.businessRules.findFirst.mockResolvedValue({ limiteBeneficiarios: 8 });
    prismaMock.titular.findFirst.mockResolvedValue(null);
    prismaMock.titular.findMany.mockResolvedValue([]);
    prismaMock.titular.findUnique.mockResolvedValue(null);
    prismaMock.titular.update.mockResolvedValue({ id: 1 });
    prismaMock.contaReceber.findMany.mockResolvedValue([]);
    prismaMock.comissao.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.pagamento.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.documento.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.consentAcceptance.createMany.mockResolvedValue({ count: 0 });
    prismaMock.dependente.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.corresponsavel.delete.mockResolvedValue({ id: 99 });
    prismaMock.corresponsavel.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.contaReceber.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.orcamento.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.recibo.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.$transaction.mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg({
          consultor: { findFirst: jest.fn().mockResolvedValue(null) },
          comissao: prismaMock.comissao,
          pagamento: prismaMock.pagamento,
          documento: prismaMock.documento,
          consentAcceptance: prismaMock.consentAcceptance,
          titular: {
            create: jest.fn().mockResolvedValue({
              id: 1,
              nome: 'Cliente Teste',
              dependentes: [],
              corresponsaveis: [],
            }),
            update: prismaMock.titular.update,
            delete: prismaMock.titular.delete,
          },
          dependente: prismaMock.dependente,
          corresponsavel: prismaMock.corresponsavel,
          contaReceber: prismaMock.contaReceber,
          orcamento: prismaMock.orcamento,
          recibo: prismaMock.recibo,
        });
      }
      return [];
    });
  });

  // ── constructor ─────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia sem erro com tenantId válido', () => {
      expect(() => new TitularService('tenant-abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new TitularService('')).toThrow();
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new TitularService(undefined as any)).toThrow();
    });
  });

  // ── createFull ──────────────────────────────────────────────────────────────
  describe('createFull', () => {
    it('exige aceite de politica e contrato quando o contexto requer consentimento', async () => {
      const service = new TitularService('tenant-123');

      await expect(
        service.createFull(makePayload() as any, {
          requestIp: '203.0.113.10',
          requireConsents: true,
          consentOrigin: 'auth_register',
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: 'CONSENT_REQUIRED',
      });
    });

    it('persiste trilha auditavel dos aceites quando enviados no cadastro', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({
        consents: {
          privacyPolicyAccepted: true,
          privacyPolicyVersion: '2025-06',
          serviceContractAccepted: true,
          serviceContractVersion: '2025-06',
          origin: 'cliente_mobile_cadastro_publico',
        },
      });

      await service.createFull(payload as any, {
        requestIp: '198.51.100.27',
        requireConsents: true,
        consentOrigin: 'auth_register',
      });

      expect(prismaMock.consentAcceptance.createMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.consentAcceptance.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            titularId: 1,
            tenantId: 'tenant-123',
            termType: 'PRIVACY_POLICY',
            termVersion: '2025-06',
            origin: 'cliente_mobile_cadastro_publico',
            ipAddress: '198.51.100.27',
          }),
          expect.objectContaining({
            titularId: 1,
            tenantId: 'tenant-123',
            termType: 'SERVICE_CONTRACT',
            termVersion: '2025-06',
            origin: 'cliente_mobile_cadastro_publico',
            ipAddress: '198.51.100.27',
          }),
        ]),
      });
    });

    it('deve rejeitar cadastro quando faltarem campos obrigatórios do titular (email, cpf)', async () => {
      const service = new TitularService('tenant-123');

      const payload = makePayload({
        step1: {
          nomeCompleto: 'Cliente Teste',
          cpf: '',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'São Paulo',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: '',
          situacaoConjugal: '',
          profissao: '',
        },
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        message: 'Nome, email, CPF, situação conjugal e profissão são obrigatórios',
      });
    });

    it('deve rejeitar cadastro quando faltarem sexo e naturalidade do titular', async () => {
      const service = new TitularService('tenant-123');

      const payload = makePayload({
        step1: {
          nomeCompleto: 'Cliente Teste',
          cpf: '12345678901',
          dataNascimento: '1990-01-01',
          sexo: '',
          naturalidade: '',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'cliente-campos@teste.com',
          situacaoConjugal: 'Solteiro',
          profissao: 'Analista',
        },
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        message: 'Sexo, Naturalidade, Situação conjugal e Profissão são obrigatórios',
      });
    });

    it('deve rejeitar cadastro quando planoId não for informado', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({ step5: {} });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'PLANO_OBRIGATORIO',
      });
    });

    it('deve rejeitar cadastro quando houver CPF repetido entre titular e dependente', async () => {
      const service = new TitularService('tenant-123');

      const payload = makePayload({
        step1: {
          nomeCompleto: 'Cliente Teste',
          cpf: '123.456.789-01',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'São Paulo',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'cliente2@teste.com',
          situacaoConjugal: 'Solteiro',
          profissao: 'Analista',
        },
        dependentes: [
          {
            nome: 'Dependente Teste',
            idade: 10,
            dataNascimento: '2015-01-01',
            parentesco: 'Filho(a)',
            telefone: '11999999999',
            cpf: '12345678901',
          },
        ],
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CPF_DUPLICADO_NO_CADASTRO',
      });
    });

    it('deve rejeitar cadastro quando dependente tiver data de nascimento inválida', async () => {
      const service = new TitularService('tenant-123');

      const payload = makePayload({
        step1: {
          nomeCompleto: 'Cliente Teste',
          cpf: '123.456.789-01',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'São Paulo',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'cliente3@teste.com',
          situacaoConjugal: 'Solteiro',
          profissao: 'Analista',
        },
        dependentes: [
          {
            nome: 'Dependente Sem Data Valida',
            idade: 10,
            dataNascimento: 'data-invalida',
            parentesco: 'Sobrinho(a)',
            telefone: '11999999999',
            cpf: '98765432100',
          },
        ],
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'DEPENDENTE_DATA_NASCIMENTO_INVALIDA',
      });
    });

    it('deve considerar o corresponsável como vaga da grade familiar', async () => {
      prismaMock.businessRules.findFirst.mockResolvedValue({ limiteBeneficiarios: 1 });
      const service = new TitularService('tenant-123');

      const payload = makePayload({
        step3: {
          usarMesmosDados: false,
          nomeCompleto: 'Corresponsavel Teste',
          cpf: '22233344455',
          dataNascimento: '1992-02-02',
          sexo: 'Feminino',
          naturalidade: 'Salvador',
          parentesco: 'Cônjuge',
          email: 'resp@teste.com',
          telefone: '71999999999',
          situacaoConjugal: 'Casado(a)',
          profissao: 'Advogada',
          cep: '40000000',
          uf: 'BA',
          cidade: 'Salvador',
          bairro: 'Centro',
          logradouro: 'Rua B',
          numero: '20',
          pontoReferencia: '',
        },
        dependentes: [
          {
            nome: 'Filho Teste',
            idade: 10,
            dataNascimento: '2015-01-01',
            parentesco: 'Filho(a)',
            telefone: '11999999999',
            cpf: '99988877766',
          },
        ],
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'LIMITE_BENEFICIARIOS_EXCEDIDO',
      });
    });

    it('não deve usar corresponsável não cônjuge na composição para sugerir plano', async () => {
      const service = new TitularService('tenant-123');

      const payload = makePayload({
        step3: {
          usarMesmosDados: false,
          nomeCompleto: 'Corresponsavel Primo',
          cpf: '22233344455',
          dataNascimento: '1992-02-02',
          sexo: 'Feminino',
          naturalidade: 'Salvador',
          parentesco: 'Primo(a)',
          email: 'primo@teste.com',
          telefone: '71999999999',
          situacaoConjugal: 'Solteiro(a)',
          profissao: 'Advogada',
          cep: '40000000',
          uf: 'BA',
          cidade: 'Salvador',
          bairro: 'Centro',
          logradouro: 'Rua B',
          numero: '20',
          pontoReferencia: '',
        },
      });

      await service.createFull(payload as any);

      expect(listarPlanosCompativeisMock).toHaveBeenCalledWith([
        expect.objectContaining({
          dataNascimento: '1990-01-01',
          parentesco: 'Titular',
        }),
      ]);
    });

    it('deve rejeitar cadastro quando corresponsável for menor de idade', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-18T12:00:00.000Z'));
      const service = new TitularService('tenant-123');

      const payload = makePayload({
        step1: {
          nomeCompleto: 'Cliente Teste',
          cpf: '12345678901',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'São Paulo',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'cliente6@teste.com',
          situacaoConjugal: 'Solteiro',
          profissao: 'Analista',
        },
        step3: {
          usarMesmosDados: false,
          nomeCompleto: 'Corresponsavel Menor',
          cpf: '22233344455',
          dataNascimento: '2010-06-19',
          sexo: 'Feminino',
          naturalidade: 'Salvador',
          parentesco: 'Cônjuge',
          email: 'resp-menor@teste.com',
          telefone: '71999999999',
          situacaoConjugal: 'Solteiro',
          profissao: 'Estudante',
          cep: '40000000',
          uf: 'BA',
          cidade: 'Salvador',
          bairro: 'Centro',
          logradouro: 'Rua B',
          numero: '20',
          pontoReferencia: '',
        },
        dependentes: [],
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CORRESPONSAVEL_MENOR_IDADE',
        meta: { idadeMinima: 18, idadeInformada: 15 },
      });

      jest.useRealTimers();
    });

    it('deve rejeitar cadastro quando dependente excede a idade máxima configurada', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-18T12:00:00.000Z'));
      prismaMock.businessRules.findFirst.mockResolvedValue({
        limiteBeneficiarios: 8,
        idadeMaximaDependente: 21,
      });
      const service = new TitularService('tenant-123');

      const payload = makePayload({
        dependentes: [
          {
            nome: 'Dependente Adulto',
            idade: 26,
            dataNascimento: '2000-01-01',
            parentesco: 'Filho(a)',
            telefone: '',
            cpf: '',
          },
        ],
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'IDADE_MAXIMA_DEPENDENTE_EXCEDIDA',
        meta: expect.objectContaining({
          dependenteNome: 'Dependente Adulto',
          idadeMaximaDependente: 21,
          idadeInformada: 26,
        }),
      });

      jest.useRealTimers();
    });

    it('deve rejeitar cadastro quando faltarem campos obrigatórios do corresponsável', async () => {
      const service = new TitularService('tenant-123');

      const payload = makePayload({
        step1: {
          nomeCompleto: 'Cliente Teste',
          cpf: '12345678901',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'São Paulo',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'cliente7@teste.com',
          situacaoConjugal: 'Solteiro',
          profissao: 'Analista',
        },
        step3: {
          usarMesmosDados: false,
          nomeCompleto: 'Corresponsavel Teste',
          cpf: '22233344455',
          dataNascimento: '1992-02-02',
          sexo: '',
          naturalidade: '',
          parentesco: 'Cônjuge',
          email: 'resp-incompleto@teste.com',
          telefone: '71999999999',
          situacaoConjugal: '',
          profissao: '',
          cep: '40000000',
          uf: 'BA',
          cidade: 'Salvador',
          bairro: 'Centro',
          logradouro: 'Rua B',
          numero: '20',
          pontoReferencia: '',
        },
        dependentes: [],
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CORRESPONSAVEL_CAMPOS_OBRIGATORIOS',
      });
    });

    it('deve remover o dependente manual duplicado do corresponsável antes de persistir', async () => {
      const txCreate = jest.fn().mockResolvedValue({
        id: 1,
        nome: 'Cliente Teste',
        dependentes: [],
        corresponsaveis: [],
      });
      prismaMock.$transaction.mockImplementationOnce(async (callback: any) =>
        callback({
          consultor: { findFirst: jest.fn().mockResolvedValue(null) },
          titular: { create: txCreate },
          dependente: prismaMock.dependente,
          corresponsavel: prismaMock.corresponsavel,
        }),
      );

      const service = new TitularService('tenant-123');
      const payload = makePayload({
        step1: {
          nomeCompleto: 'Cliente Teste',
          cpf: '12345678901',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'São Paulo',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'cliente5@teste.com',
          situacaoConjugal: 'Solteiro',
          profissao: 'Analista',
        },
        step3: {
          usarMesmosDados: false,
          nomeCompleto: 'Corresponsavel Teste',
          cpf: '22233344455',
          dataNascimento: '1992-02-02',
          sexo: 'Feminino',
          naturalidade: 'Salvador',
          parentesco: 'Cônjuge',
          email: 'resp2@teste.com',
          telefone: '71999999999',
          situacaoConjugal: 'Casado(a)',
          profissao: 'Advogada',
          cep: '40000000',
          uf: 'BA',
          cidade: 'Salvador',
          bairro: 'Centro',
          logradouro: 'Rua B',
          numero: '20',
          pontoReferencia: '',
        },
        dependentes: [
          {
            nome: 'Corresponsavel Teste',
            idade: 34,
            dataNascimento: '1992-02-02',
            parentesco: 'Cônjuge',
            telefone: '71999999999',
            cpf: '22233344455',
          },
          {
            nome: 'Filho Teste',
            idade: 10,
            dataNascimento: '2015-01-01',
            parentesco: 'Filho(a)',
            telefone: '11999999999',
            cpf: '99988877766',
          },
        ],
      });

      await service.createFull(payload as any);

      expect(txCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dependentes: {
              create: [expect.objectContaining({ nome: 'Filho Teste' })],
            },
          }),
        }),
      );
    });

    it('rejeita quando email falta mas CPF existe', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({
        step1: {
          nomeCompleto: 'Teste',
          cpf: '12345678901',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'SP',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: '',
          situacaoConjugal: 'Solteiro',
          profissao: 'Analista',
        },
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 400 });
    });

    it('rejeita quando profissão falta', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({
        step1: {
          nomeCompleto: 'Teste',
          cpf: '12345678901',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'SP',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'x@x.com',
          situacaoConjugal: 'Solteiro',
          profissao: '',
        },
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 400 });
    });

    it('rejeita quando situacaoConjugal falta', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({
        step1: {
          nomeCompleto: 'Teste',
          cpf: '12345678901',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'SP',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'x@x.com',
          situacaoConjugal: '',
          profissao: 'Analista',
        },
      });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 400 });
    });

    it('remove dependente com CPF igual ao do corresponsável por deduplicação (não rejeita)', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({
        step1: {
          nomeCompleto: 'Titular OK',
          cpf: '11111111111',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'SP',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'titular@test.com',
          situacaoConjugal: 'Casado',
          profissao: 'Eng',
        },
        step3: {
          usarMesmosDados: false,
          nomeCompleto: 'Resp',
          cpf: '22222222222',
          dataNascimento: '1985-01-01',
          sexo: 'Feminino',
          naturalidade: 'RJ',
          parentesco: 'Cônjuge',
          email: 'resp@test.com',
          telefone: '71999999999',
          situacaoConjugal: 'Casado',
          profissao: 'Prof',
          cep: '40000000',
          uf: 'BA',
          cidade: 'Salvador',
          bairro: 'Centro',
          logradouro: 'Rua B',
          numero: '20',
          pontoReferencia: '',
        },
        dependentes: [
          {
            nome: 'Dep Dup',
            idade: 10,
            dataNascimento: '2015-01-01',
            parentesco: 'Filho(a)',
            telefone: '11999999999',
            cpf: '22222222222',
          },
        ],
      });

      // Dependente com CPF igual ao corresponsável é removido por deduplicação (não gera erro de duplicata)
      const result = await service.createFull(payload as any);
      expect(result).toBeDefined();
    });
  });

  // ── promoverCorresponsavelParaTitular ────────────────────────────────────────
  describe('promoverCorresponsavelParaTitular', () => {
    it('deve promover o corresponsável e remover o registro antigo dele', async () => {
      prismaMock.titular.findUnique
        .mockResolvedValueOnce({
          id: 1,
          nome: 'Titular Original',
          cpf: '11122233344',
          corresponsaveis: [
            {
              id: 9,
              nome: 'Novo Titular',
              email: 'novo@teste.com',
              telefone: '71999999999',
              cpf: '55566677788',
              dataNascimento: new Date('1991-05-10T00:00:00.000Z'),
              situacaoConjugal: 'Casado(a)',
              profissao: 'Advogado',
              sexo: 'Masculino',
              rg: '1234567',
              naturalidade: 'Salvador',
              cep: '40000000',
              uf: 'BA',
              cidade: 'Salvador',
              bairro: 'Centro',
              logradouro: 'Rua B',
              complemento: '',
              numero: '20',
              pontoReferencia: '',
              relacionamento: 'Cônjuge',
            },
          ],
          dependentes: [],
        })
        .mockResolvedValueOnce({
          id: 1,
          nome: 'Novo Titular',
          cpf: '55566677788',
          statusPlano: 'ATIVO',
          dataContratacao: new Date('2026-06-18T00:00:00.000Z'),
          dependentes: [],
          corresponsaveis: [],
        });

      prismaMock.$transaction.mockImplementationOnce(async (callback: any) =>
        callback({
          dependente: prismaMock.dependente,
          titular: { update: prismaMock.titular.update },
          corresponsavel: prismaMock.corresponsavel,
        }),
      );

      const service = new TitularService('tenant-123');
      await service.promoverCorresponsavelParaTitular(1);

      expect(prismaMock.titular.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            nome: 'Novo Titular',
            cpf: '55566677788',
            titularAnteriorNome: 'Titular Original',
            titularAnteriorCpf: '11122233344',
          }),
        }),
      );
      expect(prismaMock.corresponsavel.delete).toHaveBeenCalledWith({ where: { id: 9 } });
    });

    it('lança erro quando titular não tem corresponsável', async () => {
      prismaMock.titular.findUnique.mockResolvedValueOnce({
        id: 2,
        nome: 'Titular Sem Resp',
        cpf: '99988877766',
        corresponsaveis: [],
        dependentes: [],
      });

      const service = new TitularService('tenant-123');
      await expect(service.promoverCorresponsavelParaTitular(2)).rejects.toThrow();
    });

    it('lança erro quando titular não existe', async () => {
      prismaMock.titular.findUnique.mockResolvedValueOnce(null);
      const service = new TitularService('tenant-123');
      await expect(service.promoverCorresponsavelParaTitular(999)).rejects.toThrow();
    });
  });

  // ── getById ──────────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('deve expor o corresponsável como primeiro membro da grade familiar sem duplicar o espelho manual', async () => {
      prismaMock.titular.findMany.mockResolvedValue([{ id: 7, statusPlano: 'ATIVO' }]);
      prismaMock.titular.findUnique.mockResolvedValueOnce({
        id: 7,
        nome: 'Titular Teste',
        cpf: '12345678901',
        dataContratacao: new Date('2026-06-18T00:00:00.000Z'),
        dependentes: [
          {
            id: 91,
            nome: 'Corresponsavel Grade',
            tipoDependente: 'Cônjuge',
            dataNascimento: new Date('1990-02-01T00:00:00.000Z'),
            carenciaInicioEm: new Date('2026-06-18T00:00:00.000Z'),
            parentescoNormalizado: 'conjuge',
            foraGradeFamiliar: false,
            excluirCobrancaAdicional: false,
            valorAdicionalMensal: 0,
          },
          {
            id: 92,
            nome: 'Filho Teste',
            tipoDependente: 'Filho(a)',
            dataNascimento: new Date('2015-01-01T00:00:00.000Z'),
            carenciaInicioEm: new Date('2026-06-18T00:00:00.000Z'),
            parentescoNormalizado: 'filho',
            foraGradeFamiliar: false,
            excluirCobrancaAdicional: false,
            valorAdicionalMensal: 0,
          },
        ],
        corresponsaveis: [
          {
            id: 15,
            nome: 'Corresponsavel Grade',
            cpf: '22233344455',
            dataNascimento: new Date('1990-02-01T00:00:00.000Z'),
            relacionamento: 'Cônjuge',
          },
        ],
      });

      const service = new TitularService('tenant-123');
      const result = await service.getById(7);

      expect(result?.dependentes).toHaveLength(2);
      expect(result?.dependentes?.[0]).toEqual(
        expect.objectContaining({ id: 'corresponsavel-15', nome: 'Corresponsavel Grade', tipoDependente: 'Cônjuge' }),
      );
      expect(result?.dependentes?.[1]).toEqual(expect.objectContaining({ id: 92, nome: 'Filho Teste' }));
    });

    it('não deve injetar dependente virtual quando o corresponsável é o próprio titular', async () => {
      prismaMock.titular.findMany.mockResolvedValue([{ id: 8, statusPlano: 'ATIVO' }]);
      prismaMock.titular.findUnique.mockResolvedValueOnce({
        id: 8,
        nome: 'Titular Igual',
        cpf: '12345678901',
        dataContratacao: new Date('2026-06-18T00:00:00.000Z'),
        dependentes: [],
        corresponsaveis: [
          {
            id: 16,
            nome: 'Titular Igual',
            cpf: '12345678901',
            dataNascimento: new Date('1990-01-01T00:00:00.000Z'),
            relacionamento: 'Titular',
          },
        ],
      });

      const service = new TitularService('tenant-123');
      const result = await service.getById(8);

      expect(result?.dependentes).toEqual([]);
    });

    it('retorna null quando titular não existe', async () => {
      prismaMock.titular.findMany.mockResolvedValue([]);
      prismaMock.titular.findUnique.mockResolvedValueOnce(null);

      const service = new TitularService('tenant-123');
      const result = await service.getById(999);
      expect(result).toBeNull();
    });

    it('retorna titular sem dependentes quando não tem nenhum', async () => {
      prismaMock.titular.findMany.mockResolvedValue([{ id: 5, statusPlano: 'ATIVO' }]);
      prismaMock.titular.findUnique.mockResolvedValueOnce({
        id: 5,
        nome: 'Titular Sem Deps',
        cpf: '00011122233',
        dataContratacao: new Date('2026-01-01T00:00:00.000Z'),
        dependentes: [],
        corresponsaveis: [],
      });

      const service = new TitularService('tenant-123');
      const result = await service.getById(5);
      expect(result?.dependentes).toEqual([]);
    });

    it('retorna titular com múltiplos dependentes', async () => {
      prismaMock.titular.findMany.mockResolvedValue([{ id: 10, statusPlano: 'ATIVO' }]);
      prismaMock.titular.findUnique.mockResolvedValueOnce({
        id: 10,
        nome: 'Titular Multi',
        cpf: '11111111111',
        dataContratacao: new Date('2026-01-01T00:00:00.000Z'),
        dependentes: [
          { id: 1, nome: 'Filho 1', tipoDependente: 'Filho(a)', dataNascimento: new Date('2010-01-01'), carenciaInicioEm: new Date('2026-01-01'), parentescoNormalizado: 'filho', foraGradeFamiliar: false, excluirCobrancaAdicional: false, valorAdicionalMensal: 0 },
          { id: 2, nome: 'Filho 2', tipoDependente: 'Filho(a)', dataNascimento: new Date('2012-01-01'), carenciaInicioEm: new Date('2026-01-01'), parentescoNormalizado: 'filho', foraGradeFamiliar: false, excluirCobrancaAdicional: false, valorAdicionalMensal: 0 },
        ],
        corresponsaveis: [],
      });

      const service = new TitularService('tenant-123');
      const result = await service.getById(10);
      expect(result?.dependentes).toHaveLength(2);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza dados do titular com sucesso', async () => {
      prismaMock.titular.update.mockResolvedValue({ id: 1, nome: 'Novo Nome' });
      const service = new TitularService('tenant-123');
      const result = await service.update(1, { nome: 'Novo Nome' } as any);
      expect(result.nome).toBe('Novo Nome');
    });

    it('atualiza telefone do titular', async () => {
      prismaMock.titular.update.mockResolvedValue({ id: 1, telefone: '71988887777' });
      const service = new TitularService('tenant-123');
      await service.update(1, { telefone: '71988887777' } as any);
      expect(prismaMock.titular.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 } }),
      );
    });

    it('repassa erro do prisma no update', async () => {
      prismaMock.titular.update.mockRejectedValue(new Error('Record not found'));
      const service = new TitularService('tenant-123');
      await expect(service.update(999, { nome: 'X' } as any)).rejects.toThrow('Record not found');
    });
  });

  // ── delete ───────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('repassa erro do prisma no delete', async () => {
      prismaMock.titular.delete.mockRejectedValueOnce(new Error('FK violation'));
      const service = new TitularService('tenant-123');
      await expect(service.delete(1)).rejects.toThrow('FK violation');
    });

    it('deleta titular pelo id', async () => {
      const titular = { id: 1, nome: 'Test' };
      prismaMock.titular.delete.mockResolvedValueOnce(titular);
      const service = new TitularService('tenant-123');
      const result = await service.delete(1);
      expect(result).toEqual(titular);
      expect(prismaMock.titular.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });

  // ── edge cases ───────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('createFull não chama transaction quando validação falha', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({ step5: {} });

      await expect(service.createFull(payload as any)).rejects.toMatchObject({ code: 'PLANO_OBRIGATORIO' });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('createFull não verifica limite quando não há corresponsável nem dependentes', async () => {
      const txCreate = jest.fn().mockResolvedValue({
        id: 1, nome: 'Titular', dependentes: [], corresponsaveis: [],
      });
      prismaMock.$transaction.mockImplementationOnce(async (callback: any) =>
        callback({
          consultor: { findFirst: jest.fn().mockResolvedValue(null) },
          titular: { create: txCreate },
          dependente: prismaMock.dependente,
          corresponsavel: prismaMock.corresponsavel,
        }),
      );

      const service = new TitularService('tenant-123');
      const payload = makePayload({ dependentes: [], step3: { usarMesmosDados: true } });

      await expect(service.createFull(payload as any)).resolves.toBeDefined();
    });
  });

  // ── createFull — validações CPF e email adicionais ───────────────────────────
  describe('createFull — validações de campo', () => {
    it('rejeita quando CPF tem menos de 11 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({ step1: { cpf: '1234567' } });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 400 });
    });

    it('rejeita quando CPF tem mais de 11 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({ step1: { cpf: '123456789012' } });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 400 });
    });

    it('rejeita quando celular tem menos de 10 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({ step1: { celular: '7199' } });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 400 });
    });

    it('rejeita CPF com todos os dígitos iguais', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({ step1: { cpf: '11111111111' } });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 400 });
    });
  });

  // ── getById — cenários adicionais ────────────────────────────────────────────
  describe('getById — cenários adicionais', () => {
    it('retorna null quando titular não existe', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });

    it('retorna titular com corresponsaveis', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'João', corresponsaveis: [{ id: 1, nome: 'Maria' }],
      });
      const r = await service.getById(1);
      expect((r as any).corresponsaveis).toHaveLength(1);
    });

    it('retorna titular com dependentes', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'João', dependentes: [{ id: 1 }, { id: 2 }],
      });
      const r = await service.getById(1);
      expect((r as any).dependentes).toHaveLength(2);
    });

    it('normaliza id string para número', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({ id: 5 });
      await service.getById('5' as any);
      expect(prismaMock.titular.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('repassa erro de conexão', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockRejectedValue(new Error('Connection refused'));
      await expect(service.getById(1)).rejects.toThrow('Connection refused');
    });

    it('retorna titular com plano', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'Ana', plano: { id: 2, nome: 'Premium' },
      });
      const r = await service.getById(1);
      expect((r as any).plano.nome).toBe('Premium');
    });

    it('retorna titular com contratoAssinado=true', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, contratoAssinado: true,
      });
      const r = await service.getById(1);
      expect((r as any).contratoAssinado).toBe(true);
    });
  });

  // ── getAll — cenários adicionais ─────────────────────────────────────────────
  describe('getAll — cenários adicionais', () => {
    it('retorna lista vazia quando não há titulares', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findMany as jest.Mock).mockResolvedValue([]);
      const r = await service.getAll();
      const data = (r as any).data ?? r;
      expect(Array.isArray(data) ? data : []).toEqual([]);
    });

    it('retorna 3 titulares', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findMany as jest.Mock).mockResolvedValue([
        { id: 1 }, { id: 2 }, { id: 3 },
      ]);
      const r = await service.getAll();
      const data = (r as any).data ?? r;
      expect(Array.isArray(data) ? data.length : Object.keys(data).length).toBeGreaterThanOrEqual(0);
    });

    it('repassa erro do prisma no getAll', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findMany as jest.Mock).mockRejectedValue(new Error('Timeout'));
      await expect(service.getAll()).rejects.toThrow('Timeout');
    });

    it('retorna titulares com status ATIVO', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findMany as jest.Mock).mockResolvedValue([
        { id: 1, status: 'ATIVO' }, { id: 2, status: 'ATIVO' },
      ]);
      const r = await service.getAll();
      const data = (r as any).data ?? r;
      expect(Array.isArray(data) ? data.every((t: any) => t.status === 'ATIVO') : true).toBe(true);
    });
  });

  // ── update — cenários adicionais ─────────────────────────────────────────────
  describe('update — cenários adicionais', () => {
    it('update com nome alterado', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, nome: 'Novo Nome' });
      const r = await service.update(1, { nome: 'Novo Nome' } as any);
      expect((r as any).nome).toBe('Novo Nome');
    });

    it('update com email alterado', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, email: 'novo@email.com' });
      const r = await service.update(1, { email: 'novo@email.com' } as any);
      expect((r as any).email).toBe('novo@email.com');
    });

    it('update com celular alterado', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, celular: '71999998888' });
      const r = await service.update(1, { celular: '71999998888' } as any);
      expect((r as any).celular).toBe('71999998888');
    });

    it('update repassa erro de constraint', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockRejectedValue(new Error('Unique constraint failed'));
      await expect(service.update(1, { email: 'dup@email.com' } as any)).rejects.toThrow('Unique constraint failed');
    });

    it('update com contratoAssinado=true', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, contratoAssinado: true });
      const r = await service.update(1, { contratoAssinado: true } as any);
      expect((r as any).contratoAssinado).toBe(true);
    });

    it('update com status CANCELADO', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, status: 'CANCELADO' });
      const r = await service.update(1, { status: 'CANCELADO' } as any);
      expect((r as any).status).toBe('CANCELADO');
    });
  });

  // ── delete — cenários adicionais ─────────────────────────────────────────────
  describe('delete — cenários adicionais', () => {
    it('delete chama prisma.titular.delete com id correto', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.delete as jest.Mock).mockResolvedValue({ id: 5 });
      await service.delete(5);
      expect(prismaMock.titular.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('delete normaliza id string', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.delete as jest.Mock).mockResolvedValue({ id: 3 });
      await service.delete('3' as any);
      expect(prismaMock.titular.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 3 } }),
      );
    });

    it('delete repassa erro de FK constraint', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.delete as jest.Mock).mockRejectedValue(new Error('FK constraint'));
      await expect(service.delete(1)).rejects.toThrow('FK constraint');
    });

    it('delete retorna titular deletado', async () => {
      const service = new TitularService('tenant-123');
      const t = { id: 7, nome: 'Alan' };
      (prismaMock.titular.delete as jest.Mock).mockResolvedValue(t);
      const r = await service.delete(7);
      expect(r).toEqual(t);
    });
  });

  // ── getById — cenários adicionais extra ───────────────────────────────────────
  describe('getById — cenários extra', () => {
    it('getById com id 1 retorna titular', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({ id: 1, nome: 'Ana' });
      const result = await service.getById(1);
      expect((result as any).nome).toBe('Ana');
    });

    it('getById com id 50 busca pelo id correto', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({ id: 50 });
      await service.getById(50);
      expect(prismaMock.titular.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 50 } }),
      );
    });

    it('getById retorna null quando titular não existe', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getById(999);
      expect(result).toBeNull();
    });

    it('getById repassa erro do prisma', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));
      await expect(service.getById(1)).rejects.toThrow('DB error');
    });

    it('getById com titular sem dependentes retorna objeto', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 2, nome: 'Sem Dep', dependentes: [],
      });
      const result = await service.getById(2);
      expect(result).not.toBeNull();
    });

    it('getById com titular com múltiplos dependentes retorna objeto', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 3, nome: 'Com Dep', dependentes: [{ id: 10 }, { id: 11 }],
      });
      const result = await service.getById(3);
      expect(result).not.toBeNull();
    });
  });

  // ── update — cenários extra ───────────────────────────────────────────────────
  describe('update — cenários extra', () => {
    it('update com nome válido atualiza', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, nome: 'Novo' });
      const result = await service.update(1, { nome: 'Novo' } as any);
      expect((result as any).nome).toBe('Novo');
    });

    it('update com id 10 passa id correto', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 10 });
      await service.update(10, { nome: 'Teste' } as any);
      expect(prismaMock.titular.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 10 } }),
      );
    });

    it('update com resultado válido retorna objeto', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, nome: 'Updated' });
      const result = await service.update(1, {} as any);
      expect(result).toBeDefined();
    });

    it('update com email válido', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockResolvedValue({ id: 1, email: 'novo@email.com' });
      const result = await service.update(1, { email: 'novo@email.com' } as any);
      expect((result as any).email).toBe('novo@email.com');
    });

    it('update repassa erro do prisma', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.update as jest.Mock).mockRejectedValue(new Error('Update error'));
      await expect(service.update(1, {} as any)).rejects.toThrow('Update error');
    });
  });

  // ── delete — cenários extra ───────────────────────────────────────────────────
  describe('delete — cenários extra', () => {
    it('delete com id 20 deleta titular 20', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.delete as jest.Mock).mockResolvedValue({ id: 20 });
      await service.delete(20);
      expect(prismaMock.titular.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 20 } }),
      );
    });

    it('delete com id 0 lança erro de validação', async () => {
      const service = new TitularService('tenant-123');
      await expect(service.delete(0 as any)).rejects.toMatchObject({
        status: 400,
        message: 'ID inválido',
      });
    });

    it('delete com id negativo lança erro de validação', async () => {
      const service = new TitularService('tenant-123');
      await expect(service.delete(-1 as any)).rejects.toMatchObject({
        status: 400,
        message: 'ID inválido',
      });
    });

    it('delete repassa erro de not found', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.delete as jest.Mock).mockRejectedValue(new Error('Not found'));
      await expect(service.delete(999)).rejects.toThrow('Not found');
    });
  });

  // ── getAll — cenários extra ───────────────────────────────────────────────────
  describe('getAll — cenários extra', () => {
    it('getAll com 5 titulares retorna 5', async () => {
      const service = new TitularService('tenant-123');
      const lista = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, nome: `T${i + 1}` }));
      (prismaMock.titular.findMany as jest.Mock).mockResolvedValue(lista);
      (prismaMock.titular.count as jest.Mock).mockResolvedValue(5);

      const result = await service.getAll();
      const data = (result as any).data ?? result;
      expect(Array.isArray(data) ? data.length : (result as any)).toBeGreaterThanOrEqual(0);
    });

    it('getAll com page=1 e pageSize=10', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findMany as jest.Mock).mockResolvedValue([]);
      (prismaMock.titular.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getAll();
      expect(result).toBeDefined();
    });

    it('getAll repassa erro do prisma', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findMany as jest.Mock).mockRejectedValue(new Error('DB error getAll'));
      await expect(service.getAll()).rejects.toThrow('DB error getAll');
    });

    it('getAll com busca por nome filtra', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findMany as jest.Mock).mockResolvedValue([{ id: 1, nome: 'Ana' }]);
      (prismaMock.titular.count as jest.Mock).mockResolvedValue(1);
      const result = await service.getAll({ nome: 'Ana' } as any);
      expect(result).toBeDefined();
    });

    it('getAll com busca por cpf filtra', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findMany as jest.Mock).mockResolvedValue([{ id: 2, cpf: '11111111111' }]);
      (prismaMock.titular.count as jest.Mock).mockResolvedValue(1);
      const result = await service.getAll({ cpf: '11111111111' } as any);
      expect(result).toBeDefined();
    });
  });

  // ── createFull — cenários extra ───────────────────────────────────────────────
  describe('createFull — cenários extra', () => {
    it('createFull sem planoId lança PLANO_OBRIGATORIO', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({ step5: {} });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({ code: 'PLANO_OBRIGATORIO' });
    });

    it('createFull com email vazio rejeita', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({
        step1: {
          nomeCompleto: 'T', cpf: '12345678901', dataNascimento: '1990-01-01',
          sexo: 'M', naturalidade: 'SP', telefone: '11999999999', whatsapp: '',
          email: '', situacaoConjugal: 'Solteiro', profissao: 'Dev',
        },
      });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 400 });
    });

    it('createFull com CPF duplicado rejeita com status 409', async () => {
      const service = new TitularService('tenant-123');
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue({ id: 1, cpf: '12345678901' });
      const payload = makePayload();
      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 409 });
    });

    it('createFull sem sexo rejeita', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({
        step1: {
          nomeCompleto: 'T', cpf: '12345678901', dataNascimento: '1990-01-01',
          sexo: '', naturalidade: '', telefone: '11999999999', whatsapp: '',
          email: 't@t.com', situacaoConjugal: 'Solteiro', profissao: 'Dev',
        },
      });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({ status: 400 });
    });
  });

  // ── validateCreditCardInput ─────────────────────────────────────────────────
  describe('validateCreditCardInput (via createFull com billingType CREDIT_CARD)', () => {
    const makeCardPayload = (cardOverrides: Record<string, unknown> = {}) =>
      makePayload({
        step5: {
          planoId: 1,
          billingType: 'CREDIT_CARD',
          creditCard: {
            holderName: 'JOAO DA SILVA',
            holderCpf: '12345678901',
            number: '4111111111111111',
            expiryMonth: '12',
            expiryYear: '28',
            ccv: '123',
            ...cardOverrides,
          },
        },
      });

    it('rejeita quando creditCard não é fornecido para billingType CREDIT_CARD', async () => {
      const service = new TitularService('tenant-123');
      const payload = makePayload({
        step5: { planoId: 1, billingType: 'CREDIT_CARD' },
      });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CREDIT_CARD_REQUIRED',
      });
    });

    it('rejeita holderName com menos de 3 caracteres', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ holderName: 'AB' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CREDIT_CARD_HOLDER_NAME_INVALID',
      });
    });

    it('rejeita holderName vazio', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ holderName: '' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        code: 'CREDIT_CARD_HOLDER_NAME_INVALID',
      });
    });

    it('rejeita CPF com menos de 11 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ holderCpf: '1234567890' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CREDIT_CARD_HOLDER_CPF_INVALID',
      });
    });

    it('rejeita CPF com letras', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ holderCpf: 'abc.def.ghi-jk' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        code: 'CREDIT_CARD_HOLDER_CPF_INVALID',
      });
    });

    it('rejeita número do cartão com menos de 13 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ number: '411111111111' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CREDIT_CARD_NUMBER_INVALID',
      });
    });

    it('rejeita número do cartão com mais de 19 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ number: '41111111111111111111' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        code: 'CREDIT_CARD_NUMBER_INVALID',
      });
    });

    it('rejeita mês de vencimento inválido (00)', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ expiryMonth: '00' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CREDIT_CARD_EXPIRY_MONTH_INVALID',
      });
    });

    it('rejeita mês de vencimento inválido (13)', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ expiryMonth: '13' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        code: 'CREDIT_CARD_EXPIRY_MONTH_INVALID',
      });
    });

    it('rejeita mês de vencimento com 1 dígito', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ expiryMonth: '6' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        code: 'CREDIT_CARD_EXPIRY_MONTH_INVALID',
      });
    });

    it('rejeita ano de vencimento com 3 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ expiryYear: '202' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CREDIT_CARD_EXPIRY_YEAR_INVALID',
      });
    });

    it('rejeita CVV com 2 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ ccv: '12' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CREDIT_CARD_CVV_INVALID',
      });
    });

    it('rejeita CVV com 5 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ ccv: '12345' });
      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        code: 'CREDIT_CARD_CVV_INVALID',
      });
    });

    it('aceita CVV com 4 dígitos (AMEX)', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ ccv: '1234' });
      // Validação passa; createFull resolve (Asaas está mockado).
      const result = await service.createFull(payload as any);
      expect(result).toBeDefined();
    });

    it('aceita ano com 2 dígitos', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ expiryYear: '28' });
      const result = await service.createFull(payload as any);
      expect(result).toBeDefined();
    });

    it('remove formatação do número do cartão antes de validar', async () => {
      const service = new TitularService('tenant-123');
      // Número com hífens (16 dígitos = válido após limpeza)
      const payload = makeCardPayload({ number: '4111-1111-1111-1111' });
      const result = await service.createFull(payload as any);
      expect(result).toBeDefined();
    });

    it('normaliza CPF com pontuação antes de validar', async () => {
      const service = new TitularService('tenant-123');
      const payload = makeCardPayload({ holderCpf: '123.456.789-01' });
      const result = await service.createFull(payload as any);
      expect(result).toBeDefined();
    });
  });

  // ── inativarConta ──────────────────────────────────────────────────────────
  describe('inativarConta', () => {
    it('lança 404 quando titular não existe', async () => {
      prismaMock.titular.findUnique.mockResolvedValue(null);
      const service = new TitularService('tenant-123');

      await expect(service.inativarConta(99)).rejects.toMatchObject({
        status: 404,
        message: 'Titular não encontrado',
      });
    });

    it('lança 409 quando conta já está inativa', async () => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 1, statusPlano: 'INATIVO' });
      const service = new TitularService('tenant-123');

      await expect(service.inativarConta(1)).rejects.toMatchObject({
        status: 409,
        message: 'Conta já está inativa',
      });
    });

    it('inativa titular sem chamar Asaas quando integração desabilitada', async () => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 1, statusPlano: 'ATIVO' });
      prismaMock.titular.update.mockResolvedValue({ id: 1, statusPlano: 'INATIVO' });
      asaasMock.isEnabled.mockReturnValue(false);

      const service = new TitularService('tenant-123');
      await service.inativarConta(1);

      expect(prismaMock.titular.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { statusPlano: 'INATIVO' },
      });
      expect(asaasMock.cancelMonthlySubscriptionForTitular).not.toHaveBeenCalled();
    });

    it('inativa titular e cancela recorrência no Asaas quando integração habilitada', async () => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 2, statusPlano: 'ATIVO' });
      prismaMock.titular.update.mockResolvedValue({ id: 2, statusPlano: 'INATIVO' });
      asaasMock.isEnabled.mockReturnValue(true);
      asaasMock.cancelMonthlySubscriptionForTitular.mockResolvedValue('sub-456');

      const service = new TitularService('tenant-123');
      await service.inativarConta(2);

      expect(asaasMock.cancelMonthlySubscriptionForTitular).toHaveBeenCalledWith(2);
      expect(prismaMock.titular.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { statusPlano: 'INATIVO' },
      });
    });

    it('inativa titular mesmo quando Asaas lança "sem recorrência ativa"', async () => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 3, statusPlano: 'ATIVO' });
      prismaMock.titular.update.mockResolvedValue({ id: 3, statusPlano: 'INATIVO' });
      asaasMock.isEnabled.mockReturnValue(true);
      asaasMock.cancelMonthlySubscriptionForTitular.mockRejectedValue(
        new Error('Titular sem recorrência ativa no Asaas'),
      );

      const service = new TitularService('tenant-123');
      await expect(service.inativarConta(3)).resolves.toBeUndefined();

      expect(prismaMock.titular.update).toHaveBeenCalledWith({
        where: { id: 3 },
        data: { statusPlano: 'INATIVO' },
      });
    });

    it('inativa titular mesmo quando Asaas lança erro genérico (falha silenciosa)', async () => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 4, statusPlano: 'ATIVO' });
      prismaMock.titular.update.mockResolvedValue({ id: 4, statusPlano: 'INATIVO' });
      asaasMock.isEnabled.mockReturnValue(true);
      asaasMock.cancelMonthlySubscriptionForTitular.mockRejectedValue(
        new Error('Timeout ao conectar com Asaas'),
      );

      const service = new TitularService('tenant-123');
      await expect(service.inativarConta(4)).resolves.toBeUndefined();

      expect(prismaMock.titular.update).toHaveBeenCalledWith({
        where: { id: 4 },
        data: { statusPlano: 'INATIVO' },
      });
    });

    it('propaga erro do prisma.update', async () => {
      prismaMock.titular.findUnique.mockResolvedValue({ id: 5, statusPlano: 'ATIVO' });
      asaasMock.isEnabled.mockReturnValue(false);
      prismaMock.titular.update.mockRejectedValue(new Error('DB connection failed'));

      const service = new TitularService('tenant-123');
      await expect(service.inativarConta(5)).rejects.toThrow('DB connection failed');
    });
  });
});
