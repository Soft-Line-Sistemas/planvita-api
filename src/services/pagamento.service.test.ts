const prismaMock = {
  pagamento: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
  Prisma: {
    validator: () => (value: unknown) => value,
  },
}));

import { PagamentoService } from './pagamento.service';

describe('PagamentoService', () => {
  let service: PagamentoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PagamentoService('tenant-123');
  });

  // ── constructor ────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new PagamentoService('tenant-abc')).not.toThrow();
    });

    it('lança erro com tenantId vazio', () => {
      expect(() => new PagamentoService('')).toThrow();
    });

    it('lança erro com tenantId undefined', () => {
      expect(() => new PagamentoService(undefined as any)).toThrow();
    });
  });

  // ── getAll ─────────────────────────────────────────────────────────────────
  describe('getAll', () => {
    it('lista pagamentos com include do titular e plano', async () => {
      const rows = [
        {
          id: 1,
          titularId: 10,
          valor: 99.9,
          titular: {
            id: 10,
            nome: 'Cliente A',
            plano: { id: 2, nome: 'Plano Gold' },
          },
        },
      ];
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await service.getAll();

      expect(prismaMock.pagamento.findMany).toHaveBeenCalledWith({
        include: expect.objectContaining({
          titular: expect.objectContaining({
            select: expect.objectContaining({
              id: true,
              nome: true,
              email: true,
              telefone: true,
              cpf: true,
              plano: expect.any(Object),
            }),
          }),
        }),
      });
      expect(result).toEqual(rows);
    });

    it('retorna array vazio quando não há pagamentos', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getAll();
      expect(result).toEqual([]);
    });

    it('retorna múltiplos pagamentos', async () => {
      const rows = [
        { id: 1, titularId: 10, valor: 100 },
        { id: 2, titularId: 20, valor: 200 },
        { id: 3, titularId: 30, valor: 300 },
      ];
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue(rows);
      const result = await service.getAll();
      expect(result).toHaveLength(3);
    });

    it('repassa erro do prisma para cima', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockRejectedValue(new Error('DB error'));
      await expect(service.getAll()).rejects.toThrow('DB error');
    });

    it('inclui plano do titular no select', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([]);
      await service.getAll();
      const callArg = (prismaMock.pagamento.findMany as jest.Mock).mock.calls[0][0];
      expect(JSON.stringify(callArg)).toContain('plano');
    });

    it('inclui informações de titular na consulta', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([]);
      await service.getAll();
      const callArg = (prismaMock.pagamento.findMany as jest.Mock).mock.calls[0][0];
      expect(callArg.include).toHaveProperty('titular');
    });
  });

  // ── getById ────────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('busca pagamento por id normalizando o valor numérico', async () => {
      const row = { id: 7, titularId: 2, valor: 50 };
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(row);

      const result = await service.getById('7' as unknown as number);

      expect(prismaMock.pagamento.findUnique).toHaveBeenCalledWith({
        where: { id: 7 },
        include: expect.any(Object),
      });
      expect(result).toEqual(row);
    });

    it('retorna null quando pagamento não existe', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getById(999);
      expect(result).toBeNull();
    });

    it('normaliza id string para number', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      await service.getById('42' as unknown as number);
      expect(prismaMock.pagamento.findUnique).toHaveBeenCalledWith({ where: { id: 42 }, include: expect.any(Object) });
    });

    it('inclui titular no include', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      await service.getById(1);
      const call = (prismaMock.pagamento.findUnique as jest.Mock).mock.calls[0][0];
      expect(call.include).toBeDefined();
    });

    it('repassa erro do prisma para cima', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockRejectedValue(new Error('Timeout'));
      await expect(service.getById(1)).rejects.toThrow('Timeout');
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('cria novo pagamento quando não existe asaasPaymentId duplicado', async () => {
      const payload = {
        titularId: 10,
        valor: 150,
        dataPagamento: new Date('2026-06-18T00:00:00.000Z'),
        status: 'PENDENTE',
        metodoPagamento: 'PIX',
        asaasPaymentId: 'pay_new',
      };
      const created = { id: 100, ...payload };

      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue(created);

      const result = await service.create(payload as any);

      expect(prismaMock.pagamento.findUnique).toHaveBeenCalledWith({ where: { asaasPaymentId: 'pay_new' } });
      expect(prismaMock.pagamento.create).toHaveBeenCalledWith({ data: payload });
      expect(prismaMock.pagamento.update).not.toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it('atualiza pagamento existente quando o asaasPaymentId já está cadastrado', async () => {
      const payload = {
        titularId: 10,
        valor: 150,
        dataPagamento: new Date('2026-06-18T00:00:00.000Z'),
        status: 'RECEBIDO',
        metodoPagamento: 'PIX',
        asaasPaymentId: 'pay_existing',
      };
      const existing = { id: 42, asaasPaymentId: 'pay_existing' };
      const updated = { ...existing, ...payload };

      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(existing);
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.create(payload as any);

      expect(prismaMock.pagamento.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: payload,
      });
      expect(prismaMock.pagamento.create).not.toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('cria sem verificar asaasPaymentId quando não fornecido', async () => {
      const payload = { titularId: 5, valor: 80, status: 'PENDENTE' };
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 10, ...payload });

      await service.create(payload as any);

      expect(prismaMock.pagamento.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.pagamento.create).toHaveBeenCalledWith({ data: payload });
    });

    it('cria pagamento com status RECEBIDO', async () => {
      const payload = { titularId: 1, valor: 200, status: 'RECEBIDO', asaasPaymentId: 'pay_abc' };
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 1, ...payload });

      const result = await service.create(payload as any);
      expect(result.status).toBe('RECEBIDO');
    });

    it('cria pagamento com metodoPagamento BOLETO', async () => {
      const payload = { titularId: 2, valor: 150, status: 'PENDENTE', metodoPagamento: 'BOLETO' };
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 2, ...payload });

      await service.create(payload as any);
      expect(prismaMock.pagamento.create).toHaveBeenCalledWith({ data: payload });
    });

    it('cria pagamento com metodoPagamento CREDIT_CARD', async () => {
      const payload = { titularId: 3, valor: 250, status: 'RECEBIDO', metodoPagamento: 'CREDIT_CARD' };
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 3, ...payload });

      await service.create(payload as any);
      expect(prismaMock.pagamento.create).toHaveBeenCalledWith({ data: payload });
    });

    it('repassa erro do prisma no create', async () => {
      (prismaMock.pagamento.create as jest.Mock).mockRejectedValue(new Error('Constraint error'));
      await expect(service.create({ titularId: 1, valor: 100 } as any)).rejects.toThrow('Constraint error');
    });

    it('repassa erro do prisma no update de upsert implícito', async () => {
      const existing = { id: 1, asaasPaymentId: 'pay_x' };
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(existing);
      (prismaMock.pagamento.update as jest.Mock).mockRejectedValue(new Error('Update failed'));

      await expect(service.create({ asaasPaymentId: 'pay_x', valor: 100 } as any)).rejects.toThrow('Update failed');
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('atualiza e remove pagamento normalizando ids', async () => {
      const updated = { id: 8, status: 'CANCELADO' };
      const deleted = { id: 8 };
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue(updated);
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue(deleted);

      const resultUpdate = await service.update('8' as unknown as number, { status: 'CANCELADO' } as any);
      const resultDelete = await service.delete('8' as unknown as number);

      expect(prismaMock.pagamento.update).toHaveBeenCalledWith({
        where: { id: 8 },
        data: { status: 'CANCELADO' },
      });
      expect(prismaMock.pagamento.delete).toHaveBeenCalledWith({ where: { id: 8 } });
      expect(resultUpdate).toEqual(updated);
      expect(resultDelete).toEqual(deleted);
    });

    it('atualiza status para RECEBIDO', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 1, status: 'RECEBIDO' });
      await service.update(1, { status: 'RECEBIDO' } as any);
      expect(prismaMock.pagamento.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'RECEBIDO' } });
    });

    it('atualiza valor do pagamento', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 1, valor: 300 });
      await service.update(1, { valor: 300 } as any);
      expect(prismaMock.pagamento.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { valor: 300 } });
    });

    it('normaliza id string para number no update', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 15 });
      await service.update('15' as any, { status: 'PAGO' } as any);
      expect(prismaMock.pagamento.update).toHaveBeenCalledWith({ where: { id: 15 }, data: { status: 'PAGO' } });
    });

    it('repassa erro do prisma no update', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockRejectedValue(new Error('Record not found'));
      await expect(service.update(999, { status: 'PAGO' } as any)).rejects.toThrow('Record not found');
    });

    it('atualiza asaasSubscriptionId', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 1, asaasSubscriptionId: 'sub_abc' });
      await service.update(1, { asaasSubscriptionId: 'sub_abc' } as any);
      expect(prismaMock.pagamento.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { asaasSubscriptionId: 'sub_abc' },
      });
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('deleta pagamento por id', async () => {
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue({ id: 5 });
      const result = await service.delete(5);
      expect(result).toEqual({ id: 5 });
      expect(prismaMock.pagamento.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    });

    it('normaliza id string para number no delete', async () => {
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue({ id: 3 });
      await service.delete('3' as any);
      expect(prismaMock.pagamento.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    });

    it('repassa erro do prisma no delete', async () => {
      (prismaMock.pagamento.delete as jest.Mock).mockRejectedValue(new Error('Record not found'));
      await expect(service.delete(999)).rejects.toThrow('Record not found');
    });

    it('retorna o registro deletado', async () => {
      const deleted = { id: 7, status: 'RECEBIDO', valor: 150 };
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue(deleted);
      const result = await service.delete(7);
      expect(result).toEqual(deleted);
    });
  });

  // ── edge cases / integração ────────────────────────────────────────────────
  describe('edge cases', () => {
    it('create → update → delete ciclo completo', async () => {
      const created = { id: 50, titularId: 1, valor: 100, status: 'PENDENTE' };
      const updated = { ...created, status: 'RECEBIDO' };
      const deleted = { id: 50 };

      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue(created);
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue(updated);
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue(deleted);

      const c = await service.create({ titularId: 1, valor: 100, status: 'PENDENTE' } as any);
      const u = await service.update(c.id, { status: 'RECEBIDO' } as any);
      const d = await service.delete(u.id);

      expect(c.status).toBe('PENDENTE');
      expect(u.status).toBe('RECEBIDO');
      expect(d.id).toBe(50);
    });

    it('getAll e getById coexistem sem interferência', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue({ id: 1 });

      const all = await service.getAll();
      const one = await service.getById(1);

      expect(all).toHaveLength(2);
      expect(one?.id).toBe(1);
    });

    it('upsert com asaasPaymentId null não verifica existência', async () => {
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 1 });
      await service.create({ titularId: 1, valor: 50, asaasPaymentId: null } as any);
      // null é falsy → não chama findUnique
      expect(prismaMock.pagamento.findUnique).not.toHaveBeenCalled();
    });

    it('upsert com asaasPaymentId undefined não verifica existência', async () => {
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 1 });
      await service.create({ titularId: 1, valor: 50 } as any);
      expect(prismaMock.pagamento.findUnique).not.toHaveBeenCalled();
    });

    it('create preserva dataPagamento como Date', async () => {
      const date = new Date('2026-06-01T00:00:00.000Z');
      const payload = { titularId: 1, valor: 100, dataPagamento: date };
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 1, ...payload });
      await service.create(payload as any);
      const callData = (prismaMock.pagamento.create as jest.Mock).mock.calls[0][0].data;
      expect(callData.dataPagamento).toBe(date);
    });

    it('update retorna objeto atualizado completo', async () => {
      const updated = { id: 20, titularId: 5, valor: 400, status: 'RECEBIDO', dataPagamento: new Date() };
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue(updated);
      const result = await service.update(20, { status: 'RECEBIDO' } as any);
      expect(result).toEqual(updated);
    });

    it('getById com id=0 normaliza para 0 e busca', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      await service.getById(0);
      expect(prismaMock.pagamento.findUnique).toHaveBeenCalledWith({ where: { id: 0 }, include: expect.any(Object) });
    });

    it('create com valor zero é aceito', async () => {
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 1, valor: 0 });
      const result = await service.create({ titularId: 1, valor: 0 } as any);
      expect(result.valor).toBe(0);
    });
  });

  // ── create — cenários de status e metodoPagamento ───────────────────────────
  describe('create — cenários de status e metodoPagamento', () => {
    it('cria pagamento com status RECEBIDO', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 10, status: 'RECEBIDO' });
      const result = await service.create({ asaasPaymentId: 'pay_r', valor: 100, status: 'RECEBIDO' } as any);
      expect(result.status).toBe('RECEBIDO');
    });

    it('cria pagamento com status CONFIRMADO', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 11, status: 'CONFIRMADO' });
      const result = await service.create({ asaasPaymentId: 'pay_c', valor: 150, status: 'CONFIRMADO' } as any);
      expect(result.status).toBe('CONFIRMADO');
    });

    it('cria pagamento com status OVERDUE', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 12, status: 'OVERDUE' });
      const result = await service.create({ asaasPaymentId: 'pay_o', valor: 200, status: 'OVERDUE' } as any);
      expect(result.status).toBe('OVERDUE');
    });

    it('cria pagamento com metodoPagamento PIX', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 13, metodoPagamento: 'PIX' });
      const result = await service.create({ asaasPaymentId: 'pay_p', valor: 100, status: 'PENDING', metodoPagamento: 'PIX' } as any);
      expect(result.metodoPagamento).toBe('PIX');
    });

    it('cria pagamento com metodoPagamento BOLETO', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 14, metodoPagamento: 'BOLETO' });
      const result = await service.create({ asaasPaymentId: 'pay_b', valor: 100, status: 'PENDING', metodoPagamento: 'BOLETO' } as any);
      expect(result.metodoPagamento).toBe('BOLETO');
    });

    it('cria pagamento com metodoPagamento CREDIT_CARD', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 15, metodoPagamento: 'CREDIT_CARD' });
      const result = await service.create({ asaasPaymentId: 'pay_cc', valor: 100, status: 'PENDING', metodoPagamento: 'CREDIT_CARD' } as any);
      expect(result.metodoPagamento).toBe('CREDIT_CARD');
    });

    it('atualiza pagamento duplicado preserva id original', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue({ id: 77 });
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 77, status: 'UPDATED' });
      const result = await service.create({ asaasPaymentId: 'pay_dup', valor: 100, status: 'PENDING' } as any);
      expect(result.id).toBe(77);
    });

    it('não chama findUnique quando asaasPaymentId não fornecido', async () => {
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 20 });
      await service.create({ valor: 50, status: 'PENDENTE' } as any);
      expect(prismaMock.pagamento.findUnique).not.toHaveBeenCalled();
    });

    it('cria pagamento com valor decimal', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 21, valor: 99.90 });
      const result = await service.create({ asaasPaymentId: 'pay_d', valor: 99.90, status: 'PENDING' } as any);
      expect(result.valor).toBeCloseTo(99.90);
    });
  });

  // ── update — cenários adicionais ─────────────────────────────────────────────
  describe('update — cenários adicionais', () => {
    it('update com paymentUrl persistido', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 10, paymentUrl: 'https://link.com' });
      const result = await service.update(10, { paymentUrl: 'https://link.com' });
      expect(result.paymentUrl).toBe('https://link.com');
    });

    it('update com pixQrCode persistido', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 10, pixQrCode: 'data:image/png' });
      const result = await service.update(10, { pixQrCode: 'data:image/png' });
      expect(result.pixQrCode).toBe('data:image/png');
    });

    it('update com asaasSubscriptionId persistido', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 10, asaasSubscriptionId: 'sub_123' });
      const result = await service.update(10, { asaasSubscriptionId: 'sub_123' } as any);
      expect((result as any).asaasSubscriptionId).toBe('sub_123');
    });

    it('update com status CANCELLED', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 10, status: 'CANCELLED' });
      const result = await service.update(10, { status: 'CANCELLED' });
      expect(result.status).toBe('CANCELLED');
    });

    it('update com status REFUNDED', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 10, status: 'REFUNDED' });
      const result = await service.update(10, { status: 'REFUNDED' });
      expect(result.status).toBe('REFUNDED');
    });

    it('update com valor alterado', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 10, valor: 300 });
      const result = await service.update(10, { valor: 300 });
      expect(result.valor).toBe(300);
    });

    it('update sem campos não falha', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 10 });
      const result = await service.update(10, {});
      expect(result.id).toBe(10);
    });

    it('update repassa erro de rede', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockRejectedValue(new Error('Network error'));
      await expect(service.update(10, { status: 'x' })).rejects.toThrow('Network error');
    });
  });

  // ── getAll — cenários adicionais ─────────────────────────────────────────────
  describe('getAll — cenários adicionais', () => {
    it('getAll retorna exatamente 0 pagamentos', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getAll();
      expect(result).toHaveLength(0);
    });

    it('getAll retorna 5 pagamentos', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ id: i + 1 })),
      );
      const result = await service.getAll();
      expect(result).toHaveLength(5);
    });

    it('getAll retorna pagamentos com statuses mistos', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([
        { id: 1, status: 'PENDING' },
        { id: 2, status: 'RECEIVED' },
        { id: 3, status: 'OVERDUE' },
      ]);
      const result = await service.getAll();
      const statuses = result.map((p: any) => p.status);
      expect(statuses).toContain('PENDING');
      expect(statuses).toContain('RECEIVED');
      expect(statuses).toContain('OVERDUE');
    });

    it('getAll repassa erro do prisma', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockRejectedValue(new Error('DB crash'));
      await expect(service.getAll()).rejects.toThrow('DB crash');
    });
  });

  // ── delete — cenários adicionais ─────────────────────────────────────────────
  describe('delete — cenários adicionais', () => {
    it('delete chama com id correto', async () => {
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue({ id: 42 });
      await service.delete(42);
      expect(prismaMock.pagamento.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 42 } }),
      );
    });

    it('delete retorna pagamento deletado', async () => {
      const pagamento = { id: 5, valor: 100, status: 'PENDING' };
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue(pagamento);
      const result = await service.delete(5);
      expect(result).toEqual(pagamento);
    });

    it('delete normaliza id string para número', async () => {
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue({ id: 10 });
      await service.delete('10' as any);
      expect(prismaMock.pagamento.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 10 } }),
      );
    });

    it('delete repassa erro de FK constraint', async () => {
      (prismaMock.pagamento.delete as jest.Mock).mockRejectedValue(new Error('FK constraint violation'));
      await expect(service.delete(1)).rejects.toThrow('FK constraint violation');
    });

    it('delete de id que não existe repassa erro do prisma', async () => {
      (prismaMock.pagamento.delete as jest.Mock).mockRejectedValue(new Error('Record not found'));
      await expect(service.delete(9999)).rejects.toThrow('Record not found');
    });
  });

  // ── getById — cenários adicionais ────────────────────────────────────────────
  describe('getById — cenários adicionais', () => {
    it('getById retorna null para id inexistente', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await service.getById(999)).toBeNull();
    });

    it('getById retorna pagamento com contaReceber', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue({
        id: 5, valor: 100, contaReceber: { id: 1, descricao: 'Mensalidade' },
      });
      const result = await service.getById(5);
      expect((result as any).contaReceber.descricao).toBe('Mensalidade');
    });

    it('getById com id negativo retorna null', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockResolvedValue(null);
      expect(await service.getById(-5)).toBeNull();
    });

    it('getById repassa erro do prisma', async () => {
      (prismaMock.pagamento.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));
      await expect(service.getById(1)).rejects.toThrow('DB error');
    });
  });

  // ── getAll — cenários extra ──────────────────────────────────────────────────
  describe('getAll — cenários extra', () => {
    it('retorna lista vazia quando não há pagamentos', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getAll();
      expect(Array.isArray(result)).toBe(true);
    });

    it('retorna 5 pagamentos quando há 5', async () => {
      const lista = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, valor: (i + 1) * 100 }));
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue(lista);
      const result = await service.getAll();
      expect(result.length).toBe(5);
    });

    it('repassa erro do prisma', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockRejectedValue(new Error('DB getAll err'));
      await expect(service.getAll()).rejects.toThrow('DB getAll err');
    });

    it('retorna array com objetos que têm id', async () => {
      (prismaMock.pagamento.findMany as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const result = await service.getAll();
      for (const item of result) {
        expect((item as any).id).toBeDefined();
      }
    });
  });

  // ── create — cenários extra ───────────────────────────────────────────────────
  describe('create — cenários extra', () => {
    it('create com valor 0 retorna objeto', async () => {
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 1, valor: 0 });
      const result = await service.create({ valor: 0, formaPagamento: 'PIX' } as any);
      expect(result).toBeDefined();
    });

    it('create retorna objeto com id', async () => {
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 99 });
      const result = await service.create({ valor: 100 } as any);
      expect((result as any).id).toBe(99);
    });

    it('create repassa erro de validação', async () => {
      (prismaMock.pagamento.create as jest.Mock).mockRejectedValue(new Error('Validation err'));
      await expect(service.create({ valor: -1 } as any)).rejects.toThrow('Validation err');
    });

    it('create com formaPagamento BOLETO cria corretamente', async () => {
      (prismaMock.pagamento.create as jest.Mock).mockResolvedValue({ id: 5, formaPagamento: 'BOLETO' });
      const result = await service.create({ valor: 150, formaPagamento: 'BOLETO' } as any);
      expect((result as any).formaPagamento).toBe('BOLETO');
    });
  });

  // ── update — cenários extra ───────────────────────────────────────────────────
  describe('update — cenários extra', () => {
    it('update com id 10 passa where correto', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 10 });
      await service.update(10, { valor: 200 } as any);
      expect(prismaMock.pagamento.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 10 } }),
      );
    });

    it('update retorna objeto atualizado', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 1, valor: 300 });
      const result = await service.update(1, { valor: 300 } as any);
      expect((result as any).valor).toBe(300);
    });

    it('update repassa erro do prisma', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockRejectedValue(new Error('Update err'));
      await expect(service.update(1, {} as any)).rejects.toThrow('Update err');
    });

    it('update com status=PAGO persiste', async () => {
      (prismaMock.pagamento.update as jest.Mock).mockResolvedValue({ id: 1, status: 'PAGO' });
      const result = await service.update(1, { status: 'PAGO' } as any);
      expect((result as any).status).toBe('PAGO');
    });
  });

  // ── delete — cenários extra ───────────────────────────────────────────────────
  describe('delete — cenários extra', () => {
    it('delete com id 50 chama where correto', async () => {
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue({ id: 50 });
      await service.delete(50);
      expect(prismaMock.pagamento.delete).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 50 } }),
      );
    });

    it('delete retorna objeto deletado com id', async () => {
      (prismaMock.pagamento.delete as jest.Mock).mockResolvedValue({ id: 7 });
      const result = await service.delete(7);
      expect((result as any).id).toBe(7);
    });
  });
});