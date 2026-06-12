const mockFindMany = jest.fn();

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => ({
    plano: { findMany: mockFindMany },
  }),
}));

jest.mock('./titular-pricing.service', () => ({
  TitularPricingService: jest.fn().mockImplementation(() => ({})),
}));

import { PlanoService } from './plano.service';

describe('PlanoService.sugerirPlano', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('retorna o plano da maior faixa atendida pela maior idade do grupo', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 3, nome: 'Bosque Plus', valorMensal: 79.9, idadeMaxima: 70, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 5, nome: 'Bosque Senior', valorMensal: 109.9, idadeMaxima: 85, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 4, nome: 'Bosque Premium', valorMensal: 129.9, idadeMaxima: null, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
    ]);

    const service = new PlanoService('bosque');
    const resultado = await service.sugerirPlano(
      [{ dataNascimento: '1954-06-02', parentesco: 'Titular' }],
      false,
    );

    expect(resultado).toMatchObject({
      id: 5,
      nome: 'Bosque Senior',
      idadeMaxima: 85,
    });
  });

  it('usa a menor faixa quando a idade fica abaixo da primeira e o plano sem limite quando passa da ultima', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 3, nome: 'Bosque Senior', valorMensal: 109.9, idadeMaxima: 85, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 4, nome: 'Bosque Premium', valorMensal: 129.9, idadeMaxima: null, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
    ]);

    const service = new PlanoService('bosque');

    const abaixoDaPrimeiraFaixa = await service.sugerirPlano(
      [{ idade: 30, parentesco: 'Titular' }],
      false,
    );
    const acimaDaUltimaFaixa = await service.sugerirPlano(
      [{ idade: 86, parentesco: 'Titular' }],
      false,
    );

    expect(abaixoDaPrimeiraFaixa).toMatchObject({
      id: 1,
      nome: 'Bosque Social',
      idadeMaxima: 55,
    });
    expect(acimaDaUltimaFaixa).toMatchObject({
      id: 4,
      nome: 'Bosque Premium',
      idadeMaxima: null,
    });
  });

  it('mantem no retorno todos os planos elegiveis para consulta e deixa sem limite por ultimo', async () => {
    mockFindMany.mockResolvedValue([
      { id: 4, nome: 'Bosque Premium', valorMensal: 129.9, idadeMaxima: null, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 3, nome: 'Bosque Plus', valorMensal: 79.9, idadeMaxima: 70, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
    ]);

    const service = new PlanoService('bosque');
    const resultado = await service.sugerirPlano(
      [{ idade: 72, parentesco: 'Titular' }],
      true,
    );

    expect(Array.isArray(resultado)).toBe(true);
    expect(resultado).toMatchObject([
      { id: 1, idadeMaxima: 55 },
      { id: 2, idadeMaxima: 60 },
      { id: 3, idadeMaxima: 70 },
      { id: 4, idadeMaxima: null },
    ]);
  });

  it('permite ignorar composicao no cadastro para sempre sugerir plano', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 1,
        nome: 'Bosque Social',
        valorMensal: 49.99,
        idadeMaxima: 55,
        ativo: true,
        beneficios: [],
        coberturas: [],
        beneficiarios: [{ id: 1, nome: 'Titular' }, { id: 2, nome: 'Cônjuge' }],
      },
      {
        id: 2,
        nome: 'Bosque Premium',
        valorMensal: 129.9,
        idadeMaxima: null,
        ativo: true,
        beneficios: [],
        coberturas: [],
        beneficiarios: [{ id: 3, nome: 'Titular' }],
      },
    ]);

    const service = new PlanoService('bosque');

    const semIgnorarComposicao = await service.sugerirPlano(
      [
        { idade: 35, parentesco: 'Titular' },
        { idade: 30, parentesco: 'Outro' },
      ],
      true,
      false,
    );
    const ignorandoComposicao = await service.sugerirPlano(
      [
        { idade: 35, parentesco: 'Titular' },
        { idade: 30, parentesco: 'Outro' },
      ],
      true,
      true,
    );

    expect(semIgnorarComposicao).toEqual([]);
    expect(ignorandoComposicao).toMatchObject([
      { id: 1, nome: 'Bosque Social' },
      { id: 2, nome: 'Bosque Premium' },
    ]);
  });

  it('retorna Social e Essencial juntos quando todos os participantes permitidos têm até 55 anos', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 3, nome: 'Bosque Plus', valorMensal: 79.9, idadeMaxima: 70, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
    ]);

    const service = new PlanoService('bosque');
    const resultado = await service.sugerirPlano(
      [
        { idade: 40, parentesco: 'Titular' },
        { idade: 38, parentesco: 'Cônjuge' },
        { idade: 12, parentesco: 'Filho' },
      ],
      false,
    );
    const compativeis = await service.listarPlanosCompativeis([
      { idade: 40, parentesco: 'Titular' },
      { idade: 38, parentesco: 'Cônjuge' },
      { idade: 12, parentesco: 'Filho' },
    ]);

    expect(resultado).toMatchObject({ id: 1, nome: 'Bosque Social' });
    expect(compativeis).toMatchObject([
      { id: 1, nome: 'Bosque Social' },
      { id: 2, nome: 'Bosque Essencial' },
    ]);
  });

  it('oculta Social quando existe participante acima de 55 anos', async () => {
    mockFindMany.mockResolvedValue([
      { id: 1, nome: 'Bosque Social', valorMensal: 49.99, idadeMaxima: 55, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 2, nome: 'Bosque Essencial', valorMensal: 69.9, idadeMaxima: 60, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
      { id: 3, nome: 'Bosque Plus', valorMensal: 79.9, idadeMaxima: 70, ativo: true, beneficios: [], coberturas: [], beneficiarios: [] },
    ]);

    const service = new PlanoService('bosque');
    const compativeis = await service.listarPlanosCompativeis([
      { idade: 56, parentesco: 'Titular' },
    ]);

    expect(compativeis).toMatchObject([
      { id: 2, nome: 'Bosque Essencial' },
    ]);
    expect(compativeis).toHaveLength(1);
  });
});
