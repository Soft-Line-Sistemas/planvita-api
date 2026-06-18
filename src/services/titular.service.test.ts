const prismaMock = {
  businessRules: { findFirst: jest.fn() },
  titular: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  dependente: {
    deleteMany: jest.fn(),
  },
  corresponsavel: {
    delete: jest.fn(),
  },
  contaReceber: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: {
    validator: () => (value: unknown) => value,
  },
}));

jest.mock('./asaas-integration.service', () => ({
  AsaasIntegrationService: jest.fn().mockImplementation(() => ({
    ensureCustomerForTitular: jest.fn().mockResolvedValue(null),
    ensureMonthlySubscriptionForTitular: jest.fn().mockResolvedValue(null),
  })),
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

describe('TitularService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.businessRules.findFirst.mockResolvedValue({ limiteBeneficiarios: 8 });
    prismaMock.titular.findFirst.mockResolvedValue(null);
    prismaMock.titular.findMany.mockResolvedValue([]);
    prismaMock.titular.findUnique.mockResolvedValue(null);
    prismaMock.titular.update.mockResolvedValue({ id: 1 });
    prismaMock.contaReceber.findMany.mockResolvedValue([]);
    prismaMock.dependente.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.corresponsavel.delete.mockResolvedValue({ id: 99 });
    prismaMock.$transaction.mockImplementation(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg({
          consultor: { findFirst: jest.fn().mockResolvedValue(null) },
          titular: {
            create: jest.fn().mockResolvedValue({
              id: 1,
              nome: 'Cliente Teste',
              dependentes: [],
              corresponsaveis: [],
            }),
            update: prismaMock.titular.update,
          },
          dependente: prismaMock.dependente,
          corresponsavel: prismaMock.corresponsavel,
        });
      }
      return [];
    });
  });

  describe('createFull', () => {
    it('deve rejeitar cadastro quando planoId não for informado', async () => {
      const service = new TitularService('tenant-123');

      const payload = {
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
        step3: {
          usarMesmosDados: true,
        },
        dependentes: [],
        step5: {},
      };

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'PLANO_OBRIGATORIO',
      });
    });

    it('deve rejeitar cadastro quando houver CPF repetido entre titular e dependente', async () => {
      const service = new TitularService('tenant-123');

      const payload = {
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
        step3: {
          usarMesmosDados: true,
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
        step5: {
          planoId: 1,
        },
      };

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'CPF_DUPLICADO_NO_CADASTRO',
      });
    });

    it('deve rejeitar cadastro quando dependente tiver data de nascimento inválida', async () => {
      const service = new TitularService('tenant-123');

      const payload = {
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
        step3: {
          usarMesmosDados: true,
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
        step5: {
          planoId: 1,
        },
      };

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'DEPENDENTE_DATA_NASCIMENTO_INVALIDA',
      });
    });

    it('deve considerar o corresponsável como vaga da grade familiar', async () => {
      prismaMock.businessRules.findFirst.mockResolvedValue({ limiteBeneficiarios: 1 });
      const service = new TitularService('tenant-123');

      const payload = {
        step1: {
          nomeCompleto: 'Cliente Teste',
          cpf: '12345678901',
          dataNascimento: '1990-01-01',
          sexo: 'Masculino',
          naturalidade: 'São Paulo',
          telefone: '11999999999',
          whatsapp: '11999999999',
          email: 'cliente4@teste.com',
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
        step5: {
          planoId: 1,
        },
      };

      await expect(service.createFull(payload as any)).rejects.toMatchObject({
        status: 400,
        code: 'LIMITE_BENEFICIARIOS_EXCEDIDO',
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
          titular: {
            create: txCreate,
          },
          dependente: prismaMock.dependente,
          corresponsavel: prismaMock.corresponsavel,
        }),
      );

      const service = new TitularService('tenant-123');
      const payload = {
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
        step5: {
          planoId: 1,
        },
      };

      await service.createFull(payload as any);

      expect(txCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dependentes: {
              create: [
                expect.objectContaining({
                  nome: 'Filho Teste',
                }),
              ],
            },
          }),
        }),
      );
    });
  });

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
      expect(prismaMock.corresponsavel.delete).toHaveBeenCalledWith({
        where: { id: 9 },
      });
    });
  });

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
        expect.objectContaining({
          id: 'corresponsavel-15',
          nome: 'Corresponsavel Grade',
          tipoDependente: 'Cônjuge',
        }),
      );
      expect(result?.dependentes?.[1]).toEqual(
        expect.objectContaining({
          id: 92,
          nome: 'Filho Teste',
        }),
      );
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
  });
});
