// Mocks devem ser declarados antes de qualquer import do módulo testado

const prismaBosque = {
  titular: { findFirst: jest.fn(), findUnique: jest.fn() },
  titularToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const prismaPax = {
  titular: { findFirst: jest.fn(), findUnique: jest.fn() },
  titularToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const prismaLider = {
  titular: { findFirst: jest.fn(), findUnique: jest.fn() },
  titularToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: (tenantId: string) => {
    if (tenantId === 'bosque') return prismaBosque;
    if (tenantId === 'pax') return prismaPax;
    if (tenantId === 'lider') return prismaLider;
    throw new Error(`Tenant not configured: ${tenantId}`);
  },
}));

jest.mock('../utils/tenants', () => ({
  getConfiguredPublicTenants: () => ['lider', 'pax', 'bosque'],
  getTenantLabel: (id: string) =>
    ({ lider: 'Lider', pax: 'Pax', bosque: 'Campo do Bosque' })[id] ?? id,
}));

const notifierSendMock = jest.fn();
jest.mock('../utils/notificationClient', () => ({
  NotificationApiClient: jest.fn().mockImplementation(() => ({
    send: notifierSendMock,
  })),
}));

const inativarContaMock = jest.fn();
jest.mock('./titular.service', () => ({
  TitularService: jest.fn().mockImplementation(() => ({
    inativarConta: inativarContaMock,
  })),
}));

import crypto from 'crypto';
import { AccountDeletionService } from './account-deletion.service';

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

const EMAIL = 'cliente@teste.com';
const TITULAR_ATIVO = { id: 42, nome: 'João Silva', email: EMAIL, statusPlano: 'ATIVO' };
const TITULAR_INATIVO = { id: 43, nome: 'Maria', email: EMAIL, statusPlano: 'INATIVO' };

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountDeletionService();

    // Defaults: nenhum banco encontra o e-mail
    for (const prisma of [prismaBosque, prismaPax, prismaLider]) {
      prisma.titular.findFirst.mockResolvedValue(null);
      prisma.titular.findUnique.mockResolvedValue(null);
      prisma.titularToken.updateMany.mockResolvedValue({ count: 0 });
      prisma.titularToken.create.mockResolvedValue({ id: 'tok-1' });
      prisma.titularToken.findFirst.mockResolvedValue(null);
      prisma.titularToken.update.mockResolvedValue({});
    }

    notifierSendMock.mockResolvedValue({ success: true });
    inativarContaMock.mockResolvedValue(undefined);
  });

  // ─── findTenantsForEmail ──────────────────────────────────────────────────

  describe('findTenantsForEmail', () => {
    it('retorna os tenants onde o titular está ativo', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);
      prismaPax.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      const result = await service.findTenantsForEmail(EMAIL);

      expect(result.map((r) => r.tenantId)).toEqual(
        expect.arrayContaining(['bosque', 'pax']),
      );
      expect(result).toHaveLength(2);
    });

    it('retorna array vazio se e-mail não existe em nenhum tenant', async () => {
      const result = await service.findTenantsForEmail('naoexiste@teste.com');
      expect(result).toHaveLength(0);
    });

    it('exclui tenants onde o titular está inativo', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_INATIVO);
      prismaPax.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      const result = await service.findTenantsForEmail(EMAIL);

      expect(result.map((r) => r.tenantId)).toEqual(['pax']);
    });

    it('inclui o label legível de cada tenant', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      const result = await service.findTenantsForEmail(EMAIL);

      expect(result[0]).toMatchObject({ tenantId: 'bosque', label: 'Campo do Bosque' });
    });

    it('ignora erros de banco e continua nos demais tenants', async () => {
      prismaBosque.titular.findFirst.mockRejectedValue(new Error('DB down'));
      prismaPax.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      const result = await service.findTenantsForEmail(EMAIL);

      expect(result.map((r) => r.tenantId)).toEqual(['pax']);
    });

    it('normaliza o e-mail antes de buscar', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.findTenantsForEmail('  CLIENTE@TESTE.COM  ');

      expect(prismaBosque.titular.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'cliente@teste.com' } }),
      );
    });
  });

  // ─── requestDeletion ──────────────────────────────────────────────────────

  describe('requestDeletion', () => {
    it('envia e-mail com link de confirmação para o tenant informado', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion(EMAIL, 'bosque');

      expect(prismaBosque.titularToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titularId: TITULAR_ATIVO.id,
            type: 'ACCOUNT_DELETION_LINK',
            purpose: 'ACCOUNT_DELETION',
            tokenHash: expect.any(String),
            expiresAt: expect.any(Date),
          }),
        }),
      );

      expect(notifierSendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: EMAIL,
          channel: 'email',
          subject: 'Confirmação de exclusão de conta',
        }),
      );
    });

    it('o link no e-mail contém o token e o tenant corretos', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion(EMAIL, 'bosque');

      const payload = notifierSendMock.mock.calls[0][0];
      expect(payload.html).toContain('/excluir-conta/confirmar');
      expect(payload.html).toContain('tenant=bosque');
    });

    it('não envia e-mail se e-mail não existir no tenant (silencia)', async () => {
      // prismaBosque retorna null por padrão
      await service.requestDeletion(EMAIL, 'bosque');

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('não envia e-mail se titular já estiver inativo', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_INATIVO);

      await service.requestDeletion(EMAIL, 'bosque');

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('invalida tokens anteriores antes de criar novo', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion(EMAIL, 'bosque');

      expect(prismaBosque.titularToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            titularId: TITULAR_ATIVO.id,
            type: 'ACCOUNT_DELETION_LINK',
            consumedAt: null,
          }),
        }),
      );
    });

    it('token expira em ~60 minutos', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      const antes = Date.now();
      await service.requestDeletion(EMAIL, 'bosque');
      const depois = Date.now();

      const { expiresAt } = prismaBosque.titularToken.create.mock.calls[0][0].data as { expiresAt: Date };
      const diffMs = expiresAt.getTime() - antes;

      expect(diffMs).toBeGreaterThanOrEqual(59 * 60 * 1000);
      expect(diffMs).toBeLessThanOrEqual(61 * 60 * 1000 + (depois - antes));
    });

    it('armazena hash SHA-256 do token, nunca o valor cru', async () => {
      prismaBosque.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion(EMAIL, 'bosque');

      const { tokenHash } = prismaBosque.titularToken.create.mock.calls[0][0].data as { tokenHash: string };
      expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('usa o banco do tenant correto (pax, não bosque)', async () => {
      prismaPax.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion(EMAIL, 'pax');

      expect(prismaPax.titularToken.create).toHaveBeenCalled();
      expect(prismaBosque.titularToken.create).not.toHaveBeenCalled();
    });
  });

  // ─── confirmDeletion ──────────────────────────────────────────────────────

  describe('confirmDeletion', () => {
    const RAW_TOKEN = crypto.randomUUID();

    function mockValidToken() {
      prismaBosque.titularToken.findFirst.mockResolvedValue({
        id: 'tok-1',
        titularId: TITULAR_ATIVO.id,
      });
      prismaBosque.titular.findUnique.mockResolvedValue({
        id: TITULAR_ATIVO.id,
        statusPlano: 'ATIVO',
      });
    }

    it('consome o token e inativa a conta para token válido', async () => {
      mockValidToken();

      await service.confirmDeletion(RAW_TOKEN, 'bosque');

      expect(prismaBosque.titularToken.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tokenHash: sha256(RAW_TOKEN),
            type: 'ACCOUNT_DELETION_LINK',
            consumedAt: null,
          }),
        }),
      );
      expect(prismaBosque.titularToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { consumedAt: expect.any(Date) } }),
      );
      expect(inativarContaMock).toHaveBeenCalledWith(TITULAR_ATIVO.id);
    });

    it('lança erro 400 para token inexistente ou expirado', async () => {
      // prismaBosque.titularToken.findFirst retorna null por padrão

      await expect(service.confirmDeletion(RAW_TOKEN, 'bosque')).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('inválido ou expirado'),
      });

      expect(inativarContaMock).not.toHaveBeenCalled();
    });

    it('não chama inativarConta se titular já estiver inativo', async () => {
      prismaBosque.titularToken.findFirst.mockResolvedValue({ id: 'tok-1', titularId: 43 });
      prismaBosque.titular.findUnique.mockResolvedValue({ id: 43, statusPlano: 'INATIVO' });

      await service.confirmDeletion(RAW_TOKEN, 'bosque');

      expect(inativarContaMock).not.toHaveBeenCalled();
    });

    it('lança erro 404 se titular não existir mais', async () => {
      prismaBosque.titularToken.findFirst.mockResolvedValue({ id: 'tok-1', titularId: 99 });
      prismaBosque.titular.findUnique.mockResolvedValue(null);

      await expect(service.confirmDeletion(RAW_TOKEN, 'bosque')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('consome o token mesmo que inativarConta falhe', async () => {
      mockValidToken();
      inativarContaMock.mockRejectedValue(new Error('Asaas timeout'));

      await expect(service.confirmDeletion(RAW_TOKEN, 'bosque')).rejects.toThrow('Asaas timeout');

      expect(prismaBosque.titularToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { consumedAt: expect.any(Date) } }),
      );
    });

    it('busca pelo hash SHA-256, não pelo valor cru', async () => {
      mockValidToken();

      await service.confirmDeletion(RAW_TOKEN, 'bosque');

      const { where } = prismaBosque.titularToken.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(where.tokenHash).toBe(sha256(RAW_TOKEN));
      expect(where.tokenHash).not.toBe(RAW_TOKEN);
    });

    it('usa o banco do tenant correto (pax, não bosque)', async () => {
      prismaPax.titularToken.findFirst.mockResolvedValue({ id: 'tok-1', titularId: 10 });
      prismaPax.titular.findUnique.mockResolvedValue({ id: 10, statusPlano: 'ATIVO' });

      await service.confirmDeletion(RAW_TOKEN, 'pax');

      expect(prismaPax.titularToken.update).toHaveBeenCalled();
      expect(prismaBosque.titularToken.update).not.toHaveBeenCalled();
    });
  });
});
