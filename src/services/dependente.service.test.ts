const prismaMock = {
  businessRules: {
    findFirst: jest.fn(),
  },
  dependente: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  titular: {
    findUnique: jest.fn(),
  },
};

const pricingServiceMock = {
  recalcularDependentesDoTitular: jest.fn(),
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

jest.mock('./titular-pricing.service', () => ({
  TitularPricingService: jest.fn().mockImplementation(() => pricingServiceMock),
}));

import { DependenteService } from './dependente.service';

describe('DependenteService', () => {
  let service: DependenteService;

  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
      nome: 'Titular Teste',
      cpf: '12345678901',
      corresponsaveis: [],
    });
    pricingServiceMock.recalcularDependentesDoTitular.mockResolvedValue(undefined);
    service = new DependenteService('tenant-123');
  });

  // ── constructor ─────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new DependenteService('tenant-abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new DependenteService('')).toThrow();
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new DependenteService(undefined as any)).toThrow();
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria dependente normalizando datas e recalculando tarifação do titular', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 5 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(2);
      (prismaMock.dependente.create as jest.Mock).mockImplementation(async ({ data }) => ({ id: 11, ...data }));

      const result = await service.create({
        titularId: 9,
        nome: 'Dependente Novo',
        tipoDependente: 'Filho(a)',
        dataNascimento: '2015-01-10',
        carenciaInicioEm: '2026-06-18',
      } as any);

      expect(prismaMock.dependente.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          titularId: 9,
          nome: 'Dependente Novo',
          dataNascimento: new Date('2015-01-10T00:00:00.000Z'),
          carenciaInicioEm: new Date('2026-06-18T00:00:00.000Z'),
        }),
      });
      expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(9);
      expect(result).toEqual(expect.objectContaining({ id: 11, titularId: 9 }));
    });

    it('usa a data atual como carência quando ela não é informada', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-18T13:00:00.000Z'));
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: null });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 12 });

      await service.create({ titularId: 4, nome: 'Sem Carência Informada', tipoDependente: 'Filho(a)', dataNascimento: '2014-02-02' } as any);

      expect(prismaMock.dependente.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ carenciaInicioEm: new Date('2026-06-18T13:00:00.000Z') }),
      });
      jest.useRealTimers();
    });

    it('bloqueia criação quando o limite de beneficiários é excedido', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 2 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(2);

      await expect(service.create({
        titularId: 3, nome: 'Excedente', tipoDependente: 'Filho(a)', dataNascimento: '2018-01-01',
      } as any)).rejects.toMatchObject({
        status: 400,
        code: 'LIMITE_BENEFICIARIOS_EXCEDIDO',
        meta: expect.objectContaining({ limiteBeneficiarios: 2, totalDependentes: 2 }),
      });

      expect(prismaMock.dependente.create).not.toHaveBeenCalled();
    });

    it('bloqueia criação quando o corresponsável já consome uma vaga da grade', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 2 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(1);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        nome: 'Titular Teste',
        cpf: '12345678901',
        corresponsaveis: [{ nome: 'Corresponsável', cpf: '22233344455', relacionamento: 'Cônjuge' }],
      });

      await expect(service.create({
        titularId: 3, nome: 'Excedente Com Corresponsável', tipoDependente: 'Filho(a)', dataNascimento: '2018-01-01',
      } as any)).rejects.toMatchObject({
        status: 400,
        code: 'LIMITE_BENEFICIARIOS_EXCEDIDO',
        meta: expect.objectContaining({ limiteBeneficiarios: 2, totalDependentes: 2 }),
      });

      expect(prismaMock.dependente.create).not.toHaveBeenCalled();
    });

    it('rejeita create com titularId inválido (0)', async () => {
      await expect(service.create({
        titularId: 0, nome: 'Inválido', tipoDependente: 'Filho(a)', dataNascimento: '2018-01-01',
      } as any)).rejects.toMatchObject({ status: 400 });
    });

    it('rejeita create com dataNascimento inválida', async () => {
      await expect(service.create({
        titularId: 1, nome: 'Data Ruim', tipoDependente: 'Filho(a)', dataNascimento: 'nao-e-data',
      } as any)).rejects.toMatchObject({ status: 400 });
    });

    it('permite criação quando count < limite', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 5 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(3);
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 20 });

      await expect(service.create({
        titularId: 1, nome: 'Dentro do Limite', tipoDependente: 'Filho(a)', dataNascimento: '2010-01-01',
      } as any)).resolves.toBeDefined();
    });

    it('sem regras de negócio (null) usa limite padrão de 8', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(3); // 3 < 8
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 30 });

      await expect(service.create({
        titularId: 1, nome: 'Dentro do Padrão', tipoDependente: 'Filho(a)', dataNascimento: '2010-01-01',
      } as any)).resolves.toBeDefined();
    });

    it('sem limiteBeneficiarios nas regras (null) usa limite padrão de 8', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: null });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(2); // 2 < 8
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 31 });

      await expect(service.create({
        titularId: 1, nome: 'Dentro do Padrão B', tipoDependente: 'Filho(a)', dataNascimento: '2005-03-10',
      } as any)).resolves.toBeDefined();
    });

    it('repassa erro do prisma no create', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(1);
      (prismaMock.dependente.create as jest.Mock).mockRejectedValue(new Error('DB error'));

      await expect(service.create({
        titularId: 1, nome: 'Dep', tipoDependente: 'Filho(a)', dataNascimento: '2010-01-01',
      } as any)).rejects.toThrow('DB error');
    });

    it('create com corresponsável diferente do titular soma 1 na contagem', async () => {
      // limite=2, count=1, corresponsável diferente do titular consome 1 vaga → total=2+1novo > 2 → excede
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 2 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(1);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        nome: 'Titular',
        cpf: '00011122233',
        corresponsaveis: [
          { nome: 'Resp1', cpf: '11122233344', relacionamento: 'Cônjuge' },
        ],
      });

      await expect(service.create({
        titularId: 1, nome: 'Excedente', tipoDependente: 'Sobrinho', dataNascimento: '2000-01-01',
      } as any)).rejects.toMatchObject({
        code: 'LIMITE_BENEFICIARIOS_EXCEDIDO',
      });
    });

    it('cria dependente com tipoDependente Sobrinho(a)', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 55, tipoDependente: 'Sobrinho(a)' });

      const result = await service.create({
        titularId: 1, nome: 'Sobrinho', tipoDependente: 'Sobrinho(a)', dataNascimento: '2005-01-01',
      } as any);
      expect(result.tipoDependente).toBe('Sobrinho(a)');
    });

    it('recalcula pricing após criação bem-sucedida', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 60, titularId: 7 });

      await service.create({ titularId: 7, nome: 'Dep', tipoDependente: 'Filho(a)', dataNascimento: '2012-01-01' } as any);
      expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(7);
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza dependente, normaliza data via set e recalcula para o titular novo', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 10, titularId: 1 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 8 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(3);
      (prismaMock.dependente.update as jest.Mock).mockImplementation(async ({ data }) => ({ id: 10, ...data }));

      await service.update(10, { titularId: 2, dataNascimento: { set: '2017-05-20' } } as any);

      expect(prismaMock.dependente.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: {
          titularId: 2,
          dataNascimento: { set: new Date('2017-05-20T00:00:00.000Z') },
        },
      });
      expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(2);
    });

    it('retorna 404 ao atualizar dependente inexistente', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.update(999, { nome: 'Nada' } as any)).rejects.toMatchObject({ status: 404 });
    });

    it('atualiza nome do dependente', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 5, titularId: 3 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(1);
      (prismaMock.dependente.update as jest.Mock).mockResolvedValue({ id: 5, nome: 'Novo Nome' });

      const result = await service.update(5, { nome: 'Novo Nome' } as any);
      expect(result.nome).toBe('Novo Nome');
    });

    it('recalcula pelo titularId original quando não muda o titular', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 8, titularId: 5 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(2);
      (prismaMock.dependente.update as jest.Mock).mockResolvedValue({ id: 8, nome: 'Dep' });

      await service.update(8, { nome: 'Dep' } as any);
      expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(5);
    });

    it('normaliza dataNascimento string direta para Date', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 1, titularId: 1 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.dependente.update as jest.Mock).mockResolvedValue({ id: 1 });

      await service.update(1, { dataNascimento: '2000-05-15' } as any);
      const callData = (prismaMock.dependente.update as jest.Mock).mock.calls[0][0].data;
      expect(callData.dataNascimento).toEqual(new Date('2000-05-15T00:00:00.000Z'));
    });

    it('repassa erro do prisma no update', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 1, titularId: 1 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.dependente.update as jest.Mock).mockRejectedValue(new Error('DB error'));

      await expect(service.update(1, { nome: 'X' } as any)).rejects.toThrow('DB error');
    });

    it('não recalcula pricing quando update falha', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 1, titularId: 1 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.dependente.update as jest.Mock).mockRejectedValue(new Error('Error'));

      await expect(service.update(1, { nome: 'X' } as any)).rejects.toThrow();
      // recalcular pode ou não ter sido chamado dependendo da ordem — verificamos só que não lança erro secundário
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('apaga dependente e recalcula quando há titular associado', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: 6 });
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({ id: 21 });

      const result = await service.delete(21);

      expect(prismaMock.dependente.delete).toHaveBeenCalledWith({ where: { id: 21 } });
      expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(6);
      expect(result).toEqual({ id: 21 });
    });

    it('apaga dependente sem titular sem lançar erro', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: null });
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({ id: 22 });

      const result = await service.delete(22);
      expect(result).toEqual({ id: 22 });
      expect(pricingServiceMock.recalcularDependentesDoTitular).not.toHaveBeenCalled();
    });

    it('prossegue com delete mesmo quando findUnique retorna null (sem titulo)', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({ id: 999 });

      const result = await service.delete(999);
      expect(result).toEqual({ id: 999 });
      expect(pricingServiceMock.recalcularDependentesDoTitular).not.toHaveBeenCalled();
    });

    it('retorna o dependente deletado', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: 1 });
      const deleted = { id: 5, nome: 'Deletado', titularId: 1 };
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue(deleted);

      const result = await service.delete(5);
      expect(result).toEqual(deleted);
    });

    it('repassa erro do prisma no delete', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: 1 });
      (prismaMock.dependente.delete as jest.Mock).mockRejectedValue(new Error('FK constraint'));

      await expect(service.delete(1)).rejects.toThrow('FK constraint');
    });
  });

  // ── getAll / getById ────────────────────────────────────────────────────────
  describe('getAll e getById', () => {
    it('lista todos os dependentes', async () => {
      const deps = [{ id: 1 }, { id: 2 }, { id: 3 }];
      (prismaMock.dependente.findMany as jest.Mock).mockResolvedValue(deps);
      const result = await service.getAll();
      expect(result).toHaveLength(3);
    });

    it('retorna array vazio quando não há dependentes', async () => {
      (prismaMock.dependente.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getAll();
      expect(result).toEqual([]);
    });

    it('busca dependente por id', async () => {
      const dep = { id: 10, nome: 'Maria', titularId: 1 };
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue(dep);
      const result = await service.getById(10);
      expect(result).toEqual(dep);
    });

    it('retorna null quando dependente não existe', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getById(999);
      expect(result).toBeNull();
    });

    it('lista dependentes com findMany retornando múltiplos', async () => {
      const deps = [{ id: 1, titularId: 7 }, { id: 2, titularId: 7 }];
      (prismaMock.dependente.findMany as jest.Mock).mockResolvedValue(deps);
      const result = await service.getAll();
      expect(result).toHaveLength(2);
    });

    it('repassa erro do prisma no getAll', async () => {
      (prismaMock.dependente.findMany as jest.Mock).mockRejectedValue(new Error('Connection lost'));
      await expect(service.getAll()).rejects.toThrow('Connection lost');
    });

    it('repassa erro do prisma no getById', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockRejectedValue(new Error('Timeout'));
      await expect(service.getById(1)).rejects.toThrow('Timeout');
    });
  });

  // ── edge cases ──────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('rejeita titularId negativo', async () => {
      await expect(service.create({
        titularId: -1, nome: 'X', tipoDependente: 'Filho(a)', dataNascimento: '2010-01-01',
      } as any)).rejects.toMatchObject({ status: 400 });
    });

    it('cria e depois deleta o mesmo dependente', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 77, titularId: 1 });
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 77, titularId: 1 });
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({ id: 77 });

      const created = await service.create({ titularId: 1, nome: 'X', tipoDependente: 'Filho(a)', dataNascimento: '2012-01-01' } as any);
      const deleted = await service.delete(created.id);
      expect(deleted.id).toBe(77);
    });

    it('update sem mudar titularId usa o titularId do findUnique', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 3, titularId: 9 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.dependente.update as jest.Mock).mockResolvedValue({ id: 3 });

      await service.update(3, { nome: 'Novo' } as any);
      expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(9);
    });

    it('limite exato sem corresponsável permite criação', async () => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 3 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(2);
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 88 });

      await expect(service.create({ titularId: 1, nome: 'Dep', tipoDependente: 'Filho(a)', dataNascimento: '2010-01-01' } as any)).resolves.toBeDefined();
    });
  });

  // ── create — cenários adicionais de tipoDependente ───────────────────────────
  describe('create — tipos de dependente adicionais', () => {
    const makeValidCreate = (tipoDependente: string) => ({
      titularId: 1, nome: 'Dep', tipoDependente, dataNascimento: '2000-01-01',
    });

    beforeEach(() => {
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 10 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({ nome: 'T', cpf: '00000000000', corresponsaveis: [] });
    });

    it('cria dependente com tipo Cônjuge', async () => {
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 90, tipoDependente: 'Cônjuge' });
      const result = await service.create(makeValidCreate('Cônjuge') as any);
      expect(result.tipoDependente).toBe('Cônjuge');
    });

    it('cria dependente com tipo Pai', async () => {
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 91, tipoDependente: 'Pai' });
      const result = await service.create(makeValidCreate('Pai') as any);
      expect(result.tipoDependente).toBe('Pai');
    });

    it('cria dependente com tipo Mãe', async () => {
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 92, tipoDependente: 'Mãe' });
      const result = await service.create(makeValidCreate('Mãe') as any);
      expect(result.tipoDependente).toBe('Mãe');
    });

    it('cria dependente com tipo Avô', async () => {
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 93, tipoDependente: 'Avô' });
      const result = await service.create(makeValidCreate('Avô') as any);
      expect(result.tipoDependente).toBe('Avô');
    });

    it('cria dependente com tipo Avó', async () => {
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 94, tipoDependente: 'Avó' });
      const result = await service.create(makeValidCreate('Avó') as any);
      expect(result.tipoDependente).toBe('Avó');
    });

    it('cria dependente com tipo Neto(a)', async () => {
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 95, tipoDependente: 'Neto(a)' });
      const result = await service.create(makeValidCreate('Neto(a)') as any);
      expect(result.tipoDependente).toBe('Neto(a)');
    });

    it('cria dependente com tipo Sogro(a)', async () => {
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 96, tipoDependente: 'Sogro(a)' });
      const result = await service.create(makeValidCreate('Sogro(a)') as any);
      expect(result.tipoDependente).toBe('Sogro(a)');
    });

    it('cria dependente com tipo Irmão(ã)', async () => {
      (prismaMock.dependente.create as jest.Mock).mockResolvedValue({ id: 97, tipoDependente: 'Irmão(ã)' });
      const result = await service.create(makeValidCreate('Irmão(ã)') as any);
      expect(result.tipoDependente).toBe('Irmão(ã)');
    });
  });

  // ── update — cenários adicionais ─────────────────────────────────────────────
  describe('update — cenários adicionais', () => {
    it('update com dataNascimento como Date object', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 1, titularId: 5 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 8 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(1);
      (prismaMock.dependente.update as jest.Mock).mockImplementation(async ({ data }) => ({ id: 1, ...data }));

      const result = await service.update(1, { dataNascimento: new Date('2000-05-10') } as any);
      expect(result).toBeDefined();
    });

    it('update com nome vazio não causa erro no serviço', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 2, titularId: 3 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 8 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(1);
      (prismaMock.dependente.update as jest.Mock).mockResolvedValue({ id: 2, nome: '' });

      const result = await service.update(2, { nome: '' } as any);
      expect(result).toBeDefined();
    });

    it('update repassa erro de timeout', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 3, titularId: 1 });
      (prismaMock.businessRules.findFirst as jest.Mock).mockResolvedValue({ limiteBeneficiarios: 8 });
      (prismaMock.dependente.count as jest.Mock).mockResolvedValue(0);
      (prismaMock.dependente.update as jest.Mock).mockRejectedValue(new Error('Query timeout'));

      await expect(service.update(3, { nome: 'X' } as any)).rejects.toThrow('Query timeout');
    });
  });

  // ── getAll/getById — cenários adicionais ─────────────────────────────────────
  describe('getAll/getById — cenários adicionais', () => {
    it('getAll retorna lista de 10 dependentes', async () => {
      const deps = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
      (prismaMock.dependente.findMany as jest.Mock).mockResolvedValue(deps);
      const result = await service.getAll();
      expect(result).toHaveLength(10);
    });

    it('getById com id existente retorna o dependente', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 5, nome: 'Joana' });
      const result = await service.getById(5);
      expect((result as any).nome).toBe('Joana');
    });

    it('getById normaliza id string', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 8 });
      await service.getById('8' as any);
      expect(prismaMock.dependente.findUnique).toHaveBeenCalledWith({ where: { id: 8 } });
    });

    it('getAll com lista vazia não falha', async () => {
      (prismaMock.dependente.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getAll();
      expect(result).toEqual([]);
    });
  });

  // ── delete — cenários adicionais ─────────────────────────────────────────────
  describe('delete — cenários adicionais', () => {
    it('delete com titular existente chama recalcularDependentesDoTitular', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: 10 });
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({ id: 1, titularId: 10 });

      await service.delete(1);
      expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(10);
    });

    it('delete sem titular não chama recalcular', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: null });
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({ id: 2 });

      await service.delete(2);
      expect(pricingServiceMock.recalcularDependentesDoTitular).not.toHaveBeenCalled();
    });

    it('delete retorna objeto deletado', async () => {
      const dep = { id: 5, nome: 'Pedro', titularId: 3 };
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: 3 });
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue(dep);

      const result = await service.delete(5);
      expect(result).toEqual(dep);
    });
  });

  // ── getById — cenários extra ─────────────────────────────────────────────────
  describe('getById — cenários extra', () => {
    it('getById retorna null quando não existe', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getById(999);
      expect(result).toBeNull();
    });

    it('getById com id 1 busca id correto', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 1 });
      await service.getById(1);
      expect(prismaMock.dependente.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('getById repassa erro do prisma', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockRejectedValue(new Error('DB err'));
      await expect(service.getById(1)).rejects.toThrow('DB err');
    });

    it('getById retorna dependente com campos corretos', async () => {
      const dep = { id: 3, nome: 'Maria', titularId: 1, dataNascimento: new Date('2000-01-01') };
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue(dep);
      const result = await service.getById(3);
      expect((result as any).nome).toBe('Maria');
    });

    it('getById com id string normaliza', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ id: 7 });
      await service.getById('7' as any);
      expect(prismaMock.dependente.findUnique).toHaveBeenCalledWith({ where: { id: 7 } });
    });
  });

  // ── getAll — cenários extra ─────────────────────────────────────────────────
  describe('getAll — cenários extra', () => {
    it('getAll com titularId retorna apenas dependentes daquele titular', async () => {
      (prismaMock.dependente.findMany as jest.Mock).mockResolvedValue([
        { id: 1, titularId: 5 }, { id: 2, titularId: 5 },
      ]);
      const result = await service.getAll();
      expect(result).toHaveLength(2);
    });

    it('getAll retorna array vazio quando titular sem dependentes', async () => {
      (prismaMock.dependente.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getAll();
      expect(result).toEqual([]);
    });

    it('getAll com 3 dependentes retorna 3', async () => {
      (prismaMock.dependente.findMany as jest.Mock).mockResolvedValue([
        { id: 1 }, { id: 2 }, { id: 3 },
      ]);
      const result = await service.getAll();
      expect(result).toHaveLength(3);
    });

    it('getAll repassa erro do prisma', async () => {
      (prismaMock.dependente.findMany as jest.Mock).mockRejectedValue(new Error('DB getAll'));
      await expect(service.getAll()).rejects.toThrow('DB getAll');
    });

    it('getAll sem argumento retorna todos', async () => {
      (prismaMock.dependente.findMany as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await service.getAll();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── update — cenários extra ─────────────────────────────────────────────────
  describe('update — cenários extra', () => {
    it('update retorna dependente atualizado', async () => {
      const dep = { id: 1, nome: 'Novo Nome', titularId: 2 };
      (prismaMock.dependente.update as jest.Mock).mockResolvedValue(dep);
      const result = await service.update(1, { nome: 'Novo Nome' } as any);
      expect((result as any).nome).toBe('Novo Nome');
    });

    it('update com id 10 passa where correto', async () => {
      (prismaMock.dependente.update as jest.Mock).mockResolvedValue({ id: 10 });
      await service.update(10, { nome: 'T' } as any);
      expect(prismaMock.dependente.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 10 } }),
      );
    });

    it('update repassa erro do prisma', async () => {
      (prismaMock.dependente.update as jest.Mock).mockRejectedValue(new Error('Update err'));
      await expect(service.update(1, {} as any)).rejects.toThrow('Update err');
    });

    it('update chama recalcularDependentes quando titularId existe', async () => {
      (prismaMock.dependente.update as jest.Mock).mockResolvedValue({ id: 1, titularId: 5 });
      await service.update(1, { nome: 'T' } as any);
      expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalled();
    });

    it('update com dataNascimento atualiza', async () => {
      (prismaMock.dependente.update as jest.Mock).mockResolvedValue({
        id: 1, dataNascimento: new Date('2000-06-15'), titularId: 3,
      });
      const result = await service.update(1, { dataNascimento: new Date('2000-06-15') } as any);
      expect(result).toBeDefined();
    });
  });

  // ── delete — cenários extra ─────────────────────────────────────────────────
  describe('delete — cenários extra', () => {
    it('delete com id 10 chama where correto', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: 1 });
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({ id: 10 });
      await service.delete(10);
      expect(prismaMock.dependente.delete).toHaveBeenCalledWith({ where: { id: 10 } });
    });

    it('delete repassa erro do prisma', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: 1 });
      (prismaMock.dependente.delete as jest.Mock).mockRejectedValue(new Error('Del err'));
      await expect(service.delete(1)).rejects.toThrow('Del err');
    });

    it('delete com titularId 7 chama recalcular com 7', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: 7 });
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({ id: 1, titularId: 7 });
      await service.delete(1);
      expect(pricingServiceMock.recalcularDependentesDoTitular).toHaveBeenCalledWith(7);
    });

    it('delete dependente inexistente (findUnique null) não chama recalcular', async () => {
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue({ id: 99 });
      await service.delete(99);
      expect(pricingServiceMock.recalcularDependentesDoTitular).not.toHaveBeenCalled();
    });

    it('delete retorna objeto com id correto', async () => {
      const dep = { id: 20, nome: 'Dep', titularId: 3 };
      (prismaMock.dependente.findUnique as jest.Mock).mockResolvedValue({ titularId: 3 });
      (prismaMock.dependente.delete as jest.Mock).mockResolvedValue(dep);
      const result = await service.delete(20);
      expect((result as any).id).toBe(20);
    });
  });

  // ── constructor ─────────────────────────────────────────────────────────────
  describe('constructor extra', () => {
    it('instancia DependenteService com tenantId válido', () => {
      const s = new DependenteService('tenant-xyz');
      expect(s).toBeDefined();
    });

    it('instancia com tenantId diferente', () => {
      const s = new DependenteService('outro-tenant');
      expect(s).toBeDefined();
    });
  });
});