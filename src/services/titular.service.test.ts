import { TitularService } from './titular.service';

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => ({
    businessRules: { findFirst: jest.fn() },
    titular: { findFirst: jest.fn() },
  }),
}));

jest.mock('./asaas-integration.service', () => ({
  AsaasIntegrationService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('./titular-pricing.service', () => ({
  TitularPricingService: jest.fn().mockImplementation(() => ({})),
}));

describe('TitularService.createFull', () => {
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
});
