// Mocks devem ser declarados antes de qualquer import do módulo testado

const prismaMock = {
  titular: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  titularToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
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

const TENANT = 'bosque';
const EMAIL = 'cliente@teste.com';
const TITULAR_ATIVO = { id: 42, nome: 'João Silva', email: EMAIL, statusPlano: 'ATIVO' };
const TITULAR_INATIVO = { id: 43, nome: 'Maria', email: 'inativo@teste.com', statusPlano: 'INATIVO' };

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountDeletionService(TENANT);

    prismaMock.titularToken.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.titularToken.create.mockResolvedValue({ id: 'tok-1' });
    notifierSendMock.mockResolvedValue({ success: true });
    inativarContaMock.mockResolvedValue(undefined);
  });

  // ─── requestDeletion ──────────────────────────────────────────────────────

  describe('requestDeletion', () => {
    it('envia e-mail com link de confirmação para titular ativo', async () => {
      prismaMock.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion(EMAIL);

      expect(prismaMock.titularToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            titularId: TITULAR_ATIVO.id,
            type: 'ACCOUNT_DELETION_LINK',
            consumedAt: null,
          }),
          data: expect.objectContaining({ consumedAt: expect.any(Date) }),
        }),
      );

      expect(prismaMock.titularToken.create).toHaveBeenCalledWith(
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

    it('o e-mail contém link com token e tenant corretos', async () => {
      prismaMock.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion(EMAIL);

      const payload = notifierSendMock.mock.calls[0][0];
      expect(payload.html).toContain('/excluir-conta/confirmar');
      expect(payload.html).toContain(`tenant=${TENANT}`);
      expect(payload.message).toContain('/excluir-conta/confirmar');
    });

    it('não envia e-mail se o e-mail não estiver cadastrado (silencia)', async () => {
      prismaMock.titular.findFirst.mockResolvedValue(null);

      await service.requestDeletion('naoexiste@teste.com');

      expect(prismaMock.titularToken.create).not.toHaveBeenCalled();
      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('não envia e-mail se o titular já estiver inativo', async () => {
      prismaMock.titular.findFirst.mockResolvedValue(TITULAR_INATIVO);

      await service.requestDeletion(TITULAR_INATIVO.email);

      expect(prismaMock.titularToken.create).not.toHaveBeenCalled();
      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('normaliza o e-mail antes de buscar (maiúsculas, espaços)', async () => {
      prismaMock.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion('  CLIENTE@TESTE.COM  ');

      expect(prismaMock.titular.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'cliente@teste.com' },
        }),
      );
    });

    it('invalida tokens anteriores antes de criar um novo', async () => {
      prismaMock.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion(EMAIL);

      const updateManyCall = prismaMock.titularToken.updateMany.mock.calls[0][0];
      const createCall = prismaMock.titularToken.create.mock.calls[0][0];

      // updateMany deve ser chamado antes do create
      expect(updateManyCall.where.consumedAt).toBeNull();
      expect(createCall.data.type).toBe('ACCOUNT_DELETION_LINK');
    });

    it('o token criado expira em ~60 minutos', async () => {
      prismaMock.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      const antes = Date.now();
      await service.requestDeletion(EMAIL);
      const depois = Date.now();

      const { expiresAt } = prismaMock.titularToken.create.mock.calls[0][0].data as { expiresAt: Date };
      const diffMs = expiresAt.getTime() - antes;

      // Entre 59 e 61 minutos
      expect(diffMs).toBeGreaterThanOrEqual(59 * 60 * 1000);
      expect(diffMs).toBeLessThanOrEqual(61 * 60 * 1000 + (depois - antes));
    });

    it('armazena o hash SHA-256 do token, nunca o valor cru', async () => {
      prismaMock.titular.findFirst.mockResolvedValue(TITULAR_ATIVO);

      await service.requestDeletion(EMAIL);

      const { tokenHash } = prismaMock.titularToken.create.mock.calls[0][0].data as { tokenHash: string };
      // Hash SHA-256 tem 64 chars hex
      expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ─── confirmDeletion ──────────────────────────────────────────────────────

  describe('confirmDeletion', () => {
    const RAW_TOKEN = crypto.randomUUID();

    function mockValidToken(titularId = TITULAR_ATIVO.id) {
      prismaMock.titularToken.findFirst.mockResolvedValue({
        id: 'tok-1',
        titularId,
      });
      prismaMock.titularToken.update.mockResolvedValue({});
      prismaMock.titular.findUnique.mockResolvedValue({ id: titularId, statusPlano: 'ATIVO' });
    }

    it('consome o token e inativa a conta para token válido', async () => {
      mockValidToken();

      await service.confirmDeletion(RAW_TOKEN);

      // Verifica que buscou pelo hash correto
      expect(prismaMock.titularToken.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tokenHash: sha256(RAW_TOKEN),
            type: 'ACCOUNT_DELETION_LINK',
            consumedAt: null,
          }),
        }),
      );

      // Marca token como consumido
      expect(prismaMock.titularToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tok-1' },
          data: { consumedAt: expect.any(Date) },
        }),
      );

      // Inativa a conta
      expect(inativarContaMock).toHaveBeenCalledWith(TITULAR_ATIVO.id);
    });

    it('lança erro 400 para token inexistente', async () => {
      prismaMock.titularToken.findFirst.mockResolvedValue(null);

      await expect(service.confirmDeletion(RAW_TOKEN)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('inválido ou expirado'),
      });

      expect(inativarContaMock).not.toHaveBeenCalled();
    });

    it('não chama inativarConta se o titular já estiver inativo', async () => {
      prismaMock.titularToken.findFirst.mockResolvedValue({ id: 'tok-1', titularId: 43 });
      prismaMock.titularToken.update.mockResolvedValue({});
      prismaMock.titular.findUnique.mockResolvedValue({ id: 43, statusPlano: 'INATIVO' });

      await service.confirmDeletion(RAW_TOKEN);

      expect(inativarContaMock).not.toHaveBeenCalled();
    });

    it('lança erro 404 se o titular não existir mais', async () => {
      prismaMock.titularToken.findFirst.mockResolvedValue({ id: 'tok-1', titularId: 99 });
      prismaMock.titularToken.update.mockResolvedValue({});
      prismaMock.titular.findUnique.mockResolvedValue(null);

      await expect(service.confirmDeletion(RAW_TOKEN)).rejects.toMatchObject({
        status: 404,
      });

      expect(inativarContaMock).not.toHaveBeenCalled();
    });

    it('consome o token mesmo que inativarConta falhe', async () => {
      mockValidToken();
      inativarContaMock.mockRejectedValue(new Error('Asaas timeout'));

      await expect(service.confirmDeletion(RAW_TOKEN)).rejects.toThrow('Asaas timeout');

      // Token deve ter sido consumido antes de tentar inativar
      expect(prismaMock.titularToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { consumedAt: expect.any(Date) } }),
      );
    });

    it('busca o token pelo hash SHA-256, não pelo valor cru', async () => {
      mockValidToken();

      await service.confirmDeletion(RAW_TOKEN);

      const { where } = prismaMock.titularToken.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(where.tokenHash).toBe(sha256(RAW_TOKEN));
      expect(where.tokenHash).not.toBe(RAW_TOKEN);
    });
  });
});
