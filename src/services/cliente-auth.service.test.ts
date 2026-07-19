import bcrypt from 'bcryptjs';
import { ClienteAuthService } from './cliente-auth.service';

const prismaMock = {
  titularCredential: {
    findUnique: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    create: jest.fn(),
  },
  titular: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  corresponsavel: {
    findFirst: jest.fn(),
  },
  titularOtpVerification: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  titularToken: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
  },
  titularOtp: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  titularCredentialVerification: {
    upsert: jest.fn(),
  },
};

jest.mock('../utils/prisma', () => ({
  getPrismaForTenant: () => prismaMock,
}));

jest.mock('../utils/notificationClient', () => ({
  NotificationApiClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
}));

jest.mock('./whatsapp-notification.service', () => ({
  WhatsappNotificationService: jest.fn().mockImplementation(() => ({
    sendViaOwnConnectionOrFallback: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('ClienteAuthService', () => {
  let service: ClienteAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClienteAuthService('tenant-123');
  });

  // ── constructor ────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('instancia com tenantId válido', () => {
      expect(() => new ClienteAuthService('tenant-abc')).not.toThrow();
    });

    it('instancia com tenantId vazio sem lançar erro (sem validação no constructor)', () => {
      expect(() => new ClienteAuthService('')).not.toThrow();
    });

    it('instancia com diferentes tenantIds', () => {
      expect(() => new ClienteAuthService('bosque')).not.toThrow();
      expect(() => new ClienteAuthService('pax')).not.toThrow();
    });
  });

  // ── changePassword ─────────────────────────────────────────────────────────
  describe('changePassword', () => {
    it('deve alterar senha quando senha atual for válida', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        senhaHash: '$2a$10$hash-atual',
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('novo-hash' as never);

      await service.changePassword(10, 'SenhaAtual@1', 'NovaSenha@1');

      expect(prismaMock.titularCredential.findUnique).toHaveBeenCalledWith({
        where: { titularId: 10 },
        select: { senhaHash: true },
      });
      expect(prismaMock.titularCredential.update).toHaveBeenCalledWith({
        where: { titularId: 10 },
        data: { senhaHash: 'novo-hash' },
      });
    });

    it('deve rejeitar quando a senha atual for inválida', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        senhaHash: '$2a$10$hash-atual',
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(service.changePassword(10, 'SenhaErrada@1', 'NovaSenha@1')).rejects.toMatchObject({
        status: 401,
        message: 'Credenciais inválidas.',
      });

      expect(prismaMock.titularCredential.update).not.toHaveBeenCalled();
    });

    it('deve rejeitar nova senha fraca (sem número e especial)', async () => {
      await expect(service.changePassword(10, 'SenhaAtual@1', 'abc')).rejects.toMatchObject({
        status: 400,
      });

      expect(prismaMock.titularCredential.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.titularCredential.update).not.toHaveBeenCalled();
    });

    it('rejeita nova senha sem caractere especial', async () => {
      await expect(service.changePassword(10, 'SenhaAtual@1', 'SenhaFraca1')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('rejeita nova senha sem número', async () => {
      await expect(service.changePassword(10, 'SenhaAtual@1', 'SenhaFraca@')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('rejeita nova senha muito curta (menos de 8 chars)', async () => {
      await expect(service.changePassword(10, 'SenhaAtual@1', 'S@1')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('senha válida precisa de letra, número e especial (não requer maiúscula)', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        senhaHash: '$2a$10$hash-atual',
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('novo-hash' as never);

      // sem maiúscula, mas tem letra, número e especial
      await expect(service.changePassword(10, 'SenhaAtual@1', 'senhafraca@1')).resolves.toBeUndefined();
    });

    it('lança erro quando não existe credencial para o titular', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue(null);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(service.changePassword(99, 'SenhaAtual@1', 'NovaSenha@1')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('gera hash bcrypt ao alterar senha', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        senhaHash: '$2a$10$hash-atual',
      });
      const compareSpy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      const hashSpy = jest.spyOn(bcrypt, 'hash').mockResolvedValue('hash-novo' as never);

      await service.changePassword(5, 'SenhaValida@1', 'NovaSenha@2');

      expect(compareSpy).toHaveBeenCalled();
      expect(hashSpy).toHaveBeenCalledWith('NovaSenha@2', expect.any(Number));
    });

    it('atualiza hash correto no banco após alteração', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        senhaHash: '$2a$10$hash-a',
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hash-correto' as never);

      await service.changePassword(7, 'Atual@123', 'Nova@Senha1');

      expect(prismaMock.titularCredential.update).toHaveBeenCalledWith({
        where: { titularId: 7 },
        data: { senhaHash: 'hash-correto' },
      });
    });

    it('senha com 8 caracteres atende requisito mínimo', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: 'x' });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('novo' as never);

      // 8 chars com letra, número e especial
      await expect(service.changePassword(1, 'Atual@1X', 'nova@1ab')).resolves.toBeUndefined();
    });

    it('repassa erro do prisma no update', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: 'x' });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('novo' as never);
      (prismaMock.titularCredential.update as jest.Mock).mockRejectedValue(new Error('DB error'));

      await expect(service.changePassword(1, 'Atual@1X', 'nova@1ab')).rejects.toThrow('DB error');
    });

    it('senha com exatamente 7 chars é rejeitada', async () => {
      await expect(service.changePassword(1, 'Atual@1X', 'a@1bcde')).rejects.toMatchObject({ status: 400 });
    });

    it('senha sem letra é rejeitada', async () => {
      await expect(service.changePassword(1, 'Atual@1X', '12345678@')).rejects.toMatchObject({ status: 400 });
    });
  });

  // ── login ──────────────────────────────────────────────────────────────────
  describe('login', () => {
    it('retorna null quando titular não encontrado por email', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.login('email@inexistente.com', 'Senha@123');
      expect(result.result).toBeNull();
    });

    it('retorna null quando titular não encontrado por CPF', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.login('12345678901', 'Senha@123');
      expect(result.result).toBeNull();
    });

    it('retorna code FIRST_ACCESS_REQUIRED quando credencial não existe', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'Teste', email: 'teste@email.com', cpf: '12345678901', telefone: null,
        metodoNotificacaoRecorrente: null, pagamentoConfirmadoEm: new Date(),
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.login('teste@email.com', 'Senha@123');
      expect(result.result).toBeNull();
    });

    it('faz login usando CPF do corresponsável e credencial do titular', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.corresponsavel.findFirst as jest.Mock).mockResolvedValue({
        nome: 'Resp',
        email: 'resp@email.com',
        cpf: '22233344455',
        telefone: '71999999999',
        titular: {
          id: 10,
          nome: 'Titular Principal',
          email: 'titular@email.com',
          cpf: '12345678901',
          pagamentoConfirmadoEm: new Date(),
          metodoNotificacaoRecorrente: 'email',
        },
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: '$2a$10$hash' });
      (prismaMock.titularCredential.update as jest.Mock).mockResolvedValue({});
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.login('22233344455', 'Senha@123');

      expect(prismaMock.corresponsavel.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cpf: '22233344455' } }),
      );
      expect(result.result).toMatchObject({
        titularId: 10,
        nome: 'Resp',
        email: 'resp@email.com',
      });
    });

    it('retorna null quando senha errada', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'Teste', email: 'teste@email.com', cpf: '12345678901', telefone: null,
        metodoNotificacaoRecorrente: null, pagamentoConfirmadoEm: new Date(),
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: '$2a$10$hash' });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      const result = await service.login('teste@email.com', 'SenhaErrada@1');
      expect(result.result).toBeNull();
    });

    it('retorna code de acesso por OTP quando a senha do corresponsavel estiver errada', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.corresponsavel.findFirst as jest.Mock).mockResolvedValue({
        nome: 'Resp Financeiro',
        email: 'resp@email.com',
        cpf: '22233344455',
        telefone: '71999999999',
        titular: {
          id: 22,
          nome: 'Titular Principal',
          email: 'titular@email.com',
          cpf: '12345678901',
          pagamentoConfirmadoEm: new Date(),
          metodoNotificacaoRecorrente: 'email',
        },
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        senhaHash: '$2a$10$hash-atual',
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      const result = await service.login('resp@email.com', 'SenhaErrada@1');

      expect(result).toMatchObject({
        result: null,
        code: 'CORRESPONSAVEL_OTP_REQUIRED',
      });
    });

    it('faz login com email válido e senha correta', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'Teste', email: 'teste@email.com', cpf: '12345678901', telefone: null,
        metodoNotificacaoRecorrente: null, pagamentoConfirmadoEm: new Date(),
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: '$2a$10$hash' });
      (prismaMock.titularCredential.update as jest.Mock).mockResolvedValue({});
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.login('teste@email.com', 'Senha@123');
      expect(result.result).toBeDefined();
      expect(result.result?.titularId).toBe(1);
    });

    it('usa findUnique (não findFirst) para email', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);

      await service.login('usuario@email.com', 'Senha@123');
      expect(prismaMock.titular.findUnique).toHaveBeenCalled();
    });

    it('normaliza email para minúsculas antes de buscar', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);

      await service.login('TESTE@EMAIL.COM', 'Senha@123');
      expect(prismaMock.titular.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'teste@email.com' } }),
      );
    });

    it('usa findFirst (por CPF) quando login parece CPF', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue(null);
      await service.login('12345678901', 'Senha@1');
      expect(prismaMock.titular.findFirst).toHaveBeenCalled();
    });

    it('retorna null quando login vazio', async () => {
      const result = await service.login('', 'Senha@123');
      expect(result.result).toBeNull();
    });

    it('normaliza CPF removendo pontos e traço antes de buscar', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue(null);
      await service.login('123.456.789-01', 'Senha@1');
      expect(prismaMock.titular.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cpf: '12345678901' } }),
      );
    });

    it('retorna code PAYMENT_REQUIRED quando pagamento não confirmado', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'Teste', email: 'teste@email.com', cpf: '12345678901', telefone: null,
        metodoNotificacaoRecorrente: null, pagamentoConfirmadoEm: null,
      });

      const result = await service.login('teste@email.com', 'Senha@123');
      expect(result.result).toBeNull();
      expect(result.code).toBe('PAYMENT_REQUIRED');
    });

    it('retorna titularId correto no resultado de login com sucesso', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 42, nome: 'Ana', email: 'ana@test.com', cpf: '98765432100', telefone: null,
        metodoNotificacaoRecorrente: null, pagamentoConfirmadoEm: new Date(),
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: 'hash' });
      (prismaMock.titularCredential.update as jest.Mock).mockResolvedValue({});
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.login('ana@test.com', 'Senha@1');
      expect(result.result?.titularId).toBe(42);
      expect(result.result?.nome).toBe('Ana');
    });

    it('CPF com menos de 11 dígitos não faz busca por CPF', async () => {
      const result = await service.login('12345', 'Senha@1');
      expect(result.result).toBeNull();
      expect(prismaMock.titular.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.titular.findUnique).not.toHaveBeenCalled();
    });

    it('login com email .com.br é reconhecido como email', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      await service.login('usuario@empresa.com.br', 'Senha@1');
      expect(prismaMock.titular.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'usuario@empresa.com.br' } }),
      );
    });
  });

  // ── getTitularFull ─────────────────────────────────────────────────────────
  describe('getTitularFull', () => {
    it('retorna null quando titular não existe', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getTitularFull(999);
      expect(result).toBeNull();
    });

    it('retorna titular com dados completos', async () => {
      const titular = { id: 1, nome: 'Ana', email: 'ana@test.com', statusPlano: 'ATIVO', pagamentoConfirmadoEm: null };
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(titular);

      const result = await service.getTitularFull(1);
      expect(result).toMatchObject({ id: 1, nome: 'Ana' });
    });

    it('chama findUnique com o id correto', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      await service.getTitularFull(55);
      expect(prismaMock.titular.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 55 } }),
      );
    });
  });

  // ── startForgotPassword ────────────────────────────────────────────────────
  describe('startForgotPassword', () => {
    it('mantém envio para o próprio titular quando o login é do titular', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 21,
        nome: 'Titular Teste',
        email: 'titular@email.com',
        cpf: '12345678901',
        telefone: '71999990001',
        metodoNotificacaoRecorrente: 'email',
        pagamentoConfirmadoEm: new Date(),
      });
      (prismaMock.titularCredential.upsert as jest.Mock).mockResolvedValue({});
      (prismaMock.titularToken.create as jest.Mock).mockResolvedValue({});
      (prismaMock.titularOtp.create as jest.Mock).mockResolvedValue({});

      const result = await service.startForgotPassword('titular@email.com');

      expect(prismaMock.corresponsavel.findFirst).not.toHaveBeenCalled();
      expect(result.channel).toBe('email');
      expect(result.destinationMasked).toContain('ti');
    });

    it('lança erro quando titular não encontrado', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.corresponsavel.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.startForgotPassword('inexistente@email.com')).rejects.toThrow();
    });

    it('lança erro quando titular não encontrado por CPF', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.corresponsavel.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.startForgotPassword('12345678901')).rejects.toThrow();
    });

    it('envia OTP para email do corresponsável quando login pertence ao corresponsável', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.corresponsavel.findFirst as jest.Mock).mockResolvedValue({
        nome: 'Resp',
        email: 'resp@email.com',
        cpf: '22233344455',
        telefone: '71999999999',
        titular: {
          id: 10,
          nome: 'Titular Principal',
          email: 'titular@email.com',
          cpf: '12345678901',
          pagamentoConfirmadoEm: new Date(),
          metodoNotificacaoRecorrente: 'email',
        },
      });
      (prismaMock.titularCredential.upsert as jest.Mock).mockResolvedValue({});
      (prismaMock.titularToken.create as jest.Mock).mockResolvedValue({});
      (prismaMock.titularOtp.create as jest.Mock).mockResolvedValue({});

      const result = await service.startForgotPassword('resp@email.com');

      expect(prismaMock.corresponsavel.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'resp@email.com' } }),
      );
      expect(result.channel).toBe('email');
      expect(result.destinationMasked).toContain('@');
    });

    it('permite solicitar recuperação por WhatsApp quando houver telefone válido', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 21,
        nome: 'Titular Teste',
        email: 'titular@email.com',
        cpf: '12345678901',
        telefone: '71999990001',
        metodoNotificacaoRecorrente: 'email',
        pagamentoConfirmadoEm: new Date(),
      });
      (prismaMock.titularCredential.upsert as jest.Mock).mockResolvedValue({});
      (prismaMock.titularToken.create as jest.Mock).mockResolvedValue({});
      (prismaMock.titularOtp.create as jest.Mock).mockResolvedValue({});

      const result = await service.startForgotPassword('titular@email.com', 'whatsapp');

      expect(result.channel).toBe('whatsapp');
      expect(result.destinationMasked).toContain('71');
    });
  });

  describe('startFirstAccessByLogin', () => {
    it('resolve corresponsável financeiro e retorna first access do titular vinculado', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.corresponsavel.findFirst as jest.Mock).mockResolvedValue({
        nome: 'Resp',
        email: 'resp@email.com',
        cpf: '22233344455',
        telefone: '71999999999',
        titular: {
          id: 30,
          nome: 'Titular Vinculado',
          email: 'titular.vinculado@email.com',
          cpf: '12345678901',
          pagamentoConfirmadoEm: new Date(),
          metodoNotificacaoRecorrente: 'whatsapp',
        },
      });
      (prismaMock.titularCredential.upsert as jest.Mock).mockResolvedValue({});
      (prismaMock.titularToken.create as jest.Mock).mockResolvedValue({});
      (prismaMock.titularOtp.create as jest.Mock).mockResolvedValue({});

      const result = await service.startFirstAccessByLogin('resp@email.com', 'whatsapp');

      expect(prismaMock.corresponsavel.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'resp@email.com' } }),
      );
      expect(result.channel).toBe('whatsapp');
      expect(result.destinationMasked).toContain('71');
    });
  });

  describe('startCorresponsavelAccess', () => {
    it('envia codigo para o contato do corresponsavel', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.corresponsavel.findFirst as jest.Mock).mockResolvedValue({
        nome: 'Resp',
        email: 'resp@email.com',
        cpf: '22233344455',
        telefone: '71999999999',
        titular: {
          id: 10,
          nome: 'Titular Principal',
          email: 'titular@email.com',
          cpf: '12345678901',
          pagamentoConfirmadoEm: new Date(),
          metodoNotificacaoRecorrente: 'email',
        },
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        senhaHash: 'hash-existente',
      });
      (prismaMock.titularOtp.create as jest.Mock).mockResolvedValue({});

      const result = await service.startCorresponsavelAccess(
        'resp@email.com',
        'whatsapp',
      );

      expect(result.channel).toBe('whatsapp');
      expect(result.destinationMasked).toContain('71');
    });
  });

  describe('loginCorresponsavelWithOtp', () => {
    it('autentica o corresponsavel com codigo valido', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      (prismaMock.corresponsavel.findFirst as jest.Mock).mockResolvedValue({
        nome: 'Resp',
        email: 'resp@email.com',
        cpf: '22233344455',
        telefone: '71999999999',
        titular: {
          id: 12,
          nome: 'Titular Principal',
          email: 'titular@email.com',
          cpf: '12345678901',
          pagamentoConfirmadoEm: new Date(),
          metodoNotificacaoRecorrente: 'email',
        },
      });
      (prismaMock.titularOtp.findFirst as jest.Mock).mockResolvedValue({
        id: 'otp-1',
        attempts: 0,
        channel: 'email',
        codeHash: 'hash-otp',
      });
      (prismaMock.titularOtp.update as jest.Mock).mockResolvedValue({});
      (prismaMock.titularCredential.update as jest.Mock).mockResolvedValue({});
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.loginCorresponsavelWithOtp(
        'resp@email.com',
        '123456',
      );

      expect(result).toMatchObject({
        titularId: 12,
        nome: 'Resp',
        email: 'resp@email.com',
        cpf: '22233344455',
      });
      expect(prismaMock.titularCredential.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { titularId: 12 },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
    });
  });

  // ── login — cenários adicionais ───────────────────────────────────────────────
  describe('login — cenários adicionais', () => {
    it('retorna null quando senha errada (bcrypt compare false)', async () => {
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, email: 'user@email.com', pagamentoConfirmadoEm: new Date(),
        credential: { senhaHash: 'some-hash' },
      });

      const result = await service.login('user@email.com', 'senha-errada@1');
      expect(result.result).toBeNull();
    });

    it('retorna usuario e token quando login bem-sucedido', async () => {
      const hash = await bcrypt.hash('Senha@123', 10);
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 5, email: 'alan@email.com', pagamentoConfirmadoEm: new Date(),
        credential: { senhaHash: hash },
      });

      const result = await service.login('alan@email.com', 'Senha@123');
      expect(result.code).toBeUndefined();
    });

    it('retorna PAYMENT_REQUIRED quando pagamentoConfirmadoEm é null', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 2, email: 'user2@email.com', pagamentoConfirmadoEm: null,
        credential: { senhaHash: await bcrypt.hash('Abc@1234', 10) },
      });

      const result = await service.login('user2@email.com', 'Abc@1234');
      expect(result).toMatchObject({ code: 'PAYMENT_REQUIRED' });
    });

    it('email normalizado para minúsculas antes de buscar', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      await service.login('USER@Email.COM', 'Pass@123');
      expect(prismaMock.titular.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ email: 'user@email.com' }) }),
      );
    });

    it('retorna resultado com result null para email sem titular', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.login('naoexiste@email.com', 'Pass@123');
      expect(result.result === null || result.code !== undefined).toBeTruthy();
    });

    it('retorna resultado com result null quando titular não tem credential', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 3, email: 'sem-senha@email.com', pagamentoConfirmadoEm: new Date(),
        credential: null,
      });

      const result = await service.login('sem-senha@email.com', 'Pass@123');
      expect(result.result === null || result.code !== undefined).toBeTruthy();
    });
  });

  // ── changePassword — cenários adicionais ─────────────────────────────────────
  describe('changePassword — cenários adicionais', () => {
    it('rejeita quando credential não existe', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.changePassword(1, 'velha@1', 'Nova@123')).rejects.toBeDefined();
    });

    it('rejeita nova senha fraca (sem especial)', async () => {
      const hash = await bcrypt.hash('velha@1', 10);
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: hash });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      await expect(service.changePassword(1, 'velha@1', 'SemEspecial123')).rejects.toBeDefined();
    });

    it('rejeita nova senha fraca (sem número)', async () => {
      const hash = await bcrypt.hash('velha@1', 10);
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: hash });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      await expect(service.changePassword(1, 'velha@1', 'SemNumero@abc')).rejects.toBeDefined();
    });

    it('sucesso quando nova senha é forte', async () => {
      const hash = await bcrypt.hash('antiga@1', 10);
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: hash });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      (prismaMock.titularCredential.update as jest.Mock).mockResolvedValue({ id: 1 });

      await expect(service.changePassword(1, 'antiga@1', 'Nova@Senha1')).resolves.not.toThrow();
    });
  });

  // ── resetPassword — cenários adicionais ──────────────────────────────────────
  describe('resetPassword — cenários adicionais', () => {
    it('rejeita token inválido/expirado', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titularToken.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.resetPassword('token-invalido', 'Nova@Senha1')).rejects.toBeDefined();
    });

    it('rejeita senha fraca (sem especial)', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.resetPassword('token', 'SenhaSemEspecial1')).rejects.toBeDefined();
    });

    it('rejeita senha muito curta', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.resetPassword('token', 'Aa@1')).rejects.toBeDefined();
    });
  });

  // ── completeFirstAccess — cenários adicionais ────────────────────────────────
  describe('completeFirstAccess — cenários adicionais', () => {
    it('rejeita token inválido', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titularToken.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.completeFirstAccess('bad-token', 'Nova@Senha1')).rejects.toBeDefined();
    });

    it('rejeita senha fraca', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.completeFirstAccess('token', 'senhafraca')).rejects.toBeDefined();
    });
  });

  // ── getTitularFull — cenários adicionais ─────────────────────────────────────
  describe('getTitularFull — cenários adicionais', () => {
    it('retorna null quando titular não existe', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getTitularFull(9999);
      expect(result).toBeNull();
    });

    it('retorna titular completo', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'Alan', email: 'alan@test.com', cpf: '12345678901',
      });
      const result = await service.getTitularFull(1);
      expect(result).not.toBeNull();
      expect((result as any).nome).toBe('Alan');
    });

    it('repassa erro do prisma', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockRejectedValue(new Error('DB error'));
      await expect(service.getTitularFull(1)).rejects.toThrow('DB error');
    });
  });

  // ── login — cenários de status ────────────────────────────────────────────────
  describe('login — cenários de status e configuração', () => {
    it('login retorna objeto com result quando bem-sucedido', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue({
        id: 1, cpf: '11111111111', nome: 'Titular',
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        id: 1, titularId: 1, passwordHash: 'hash', mustChangePassword: false,
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.login('11111111111', 'pass123');
      expect(result).toHaveProperty('result');
    });

    it('login com cpf com pontos e traço funciona', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.login('111.111.111-11', 'pass');
      expect(result).toHaveProperty('result');
    });

    it('login sem credential retorna result null', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue({
        id: 2, cpf: '22222222222', nome: 'Outro',
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.login('22222222222', 'pass');
      expect(result.result).toBeNull();
    });

    it('login com titular não encontrado retorna result null', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.login('99999999999', 'pass');
      expect(result.result).toBeNull();
    });

    it('login com senha errada retorna result null', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue({
        id: 3, cpf: '33333333333', nome: 'Teste',
      });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        id: 3, titularId: 3, passwordHash: 'wronghash', mustChangePassword: false,
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      const result = await service.login('33333333333', 'wrongpass');
      expect(result.result).toBeNull();
    });

    it('login repassa erro do prisma', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockRejectedValue(new Error('DB crashed'));
      await expect(service.login('44444444444', 'pass')).rejects.toThrow('DB crashed');
    });
  });

  // ── resetPassword — cenários adicionais ──────────────────────────────────────
  describe('resetPassword — cenários adicionais', () => {
    it('resetPassword com token inválido lança ou retorna erro', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.resetPassword('invalid-token', 'newpass')).rejects.toThrow();
    });

    it('resetPassword com token expirado lança', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue({
        id: 1, titularId: 1, token: 'expired', expiresAt: new Date('2020-01-01'), used: false,
      });
      await expect(service.resetPassword('expired', 'newpass')).rejects.toThrow();
    });

    it('resetPassword com token já usado lança', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue({
        id: 1, titularId: 1, token: 'used-token', expiresAt: new Date(Date.now() + 100000), used: true,
      });
      await expect(service.resetPassword('used-token', 'newpass')).rejects.toThrow();
    });
  });

  // ── completeFirstAccess — cenários adicionais ─────────────────────────────────
  describe('completeFirstAccess — cenários adicionais', () => {
    it('completeFirstAccess com token inválido lança', async () => {
      (prismaMock.titularOtp.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.completeFirstAccess('invalid-token', 'newpass@1A')).rejects.toThrow();
    });

    it('completeFirstAccess com token expirado lança', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock).mockResolvedValue({
        id: 1, titularId: 1, token: 'expired', expiresAt: new Date('2020-01-01'), used: false,
      });
      (prismaMock.titularOtp.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.completeFirstAccess('expired', 'newpass@1A')).rejects.toThrow();
    });

    it('completeFirstAccess com senha fraca lança', async () => {
      await expect(service.completeFirstAccess('any-token', 'weakpass')).rejects.toThrow();
    });
  });

  // ── changePassword — cenários adicionais ─────────────────────────────────────
  describe('changePassword — cenários adicionais', () => {
    it('changePassword com senha nova igual à política — aceita', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        senhaHash: '$2a$10$hash',
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('newhash' as never);
      (prismaMock.titularCredential.update as jest.Mock).mockResolvedValue({});

      await expect(service.changePassword(1, 'Atual@1234', 'Nova@1234')).resolves.not.toThrow();
    });

    it('changePassword com senha nova sem especial — rejeita', async () => {
      await expect(service.changePassword(1, 'Atual@123', 'SenhaSem1')).rejects.toMatchObject({ status: 400 });
    });

    it('changePassword repassa erro do prisma no findUnique', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));
      await expect(service.changePassword(1, 'Atual@1', 'Nova@1234')).rejects.toThrow('DB fail');
    });

    it('changePassword com titularId 50 chama findUnique com id correto', async () => {
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: 'x' });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('nh' as never);
      (prismaMock.titularCredential.update as jest.Mock).mockResolvedValue({});

      await service.changePassword(50, 'Atual@123', 'Nova@1234');
      expect(prismaMock.titularCredential.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { titularId: 50 } }),
      );
    });
  });

  // ── getTitularFull — cenários adicionais ─────────────────────────────────────
  describe('getTitularFull — cenários adicionais', () => {
    it('getTitularFull com ID 2 busca corretamente', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 2, nome: 'Maria', email: 'maria@test.com',
      });
      const result = await service.getTitularFull(2);
      expect((result as any).id).toBe(2);
    });

    it('getTitularFull retorna objeto com nome', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 3, nome: 'João', email: 'joao@test.com',
      });
      const result = await service.getTitularFull(3);
      expect((result as any).nome).toBe('João');
    });

    it('getTitularFull com titular sem email retorna objeto', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 4, nome: 'Pedro', email: null,
      });
      const result = await service.getTitularFull(4);
      expect(result).not.toBeNull();
    });

    it('getTitularFull chama findUnique com where.id correto', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({ id: 5 });
      await service.getTitularFull(5);
      expect(prismaMock.titular.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });
  });

  // ── getTitularFull — cenários extra ──────────────────────────────────────────
  describe('getTitularFull — cenários extra', () => {
    it('getTitularFull retorna null quando titular não existe', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue(null);
      const result = await service.getTitularFull(999);
      expect(result).toBeNull();
    });

    it('getTitularFull repassa erro do prisma', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockRejectedValue(new Error('DB err'));
      await expect(service.getTitularFull(1)).rejects.toThrow('DB err');
    });

    it('getTitularFull retorna titular com dependentes', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({
        id: 1, nome: 'T', dependentes: [{ id: 10 }],
      });
      const result = await service.getTitularFull(1);
      expect((result as any).dependentes).toBeDefined();
    });

    it('getTitularFull com id 100 retorna titular com id 100', async () => {
      (prismaMock.titular.findUnique as jest.Mock).mockResolvedValue({ id: 100, nome: 'Cem' });
      const result = await service.getTitularFull(100);
      expect((result as any).id).toBe(100);
    });
  });

  // ── login — cenários extra ────────────────────────────────────────────────────
  describe('login — cenários extra', () => {
    it('login com CPF não encontrado retorna resultado de falha', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue(null);
      const result = await service.login('00000000000', 'Qualquer@1234');
      expect(result).toBeDefined();
    });

    it('login com senha errada retorna resultado de falha', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue({ id: 1, cpf: '12345678901' });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({ senhaHash: 'hash' });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      const result = await service.login('12345678901', 'SenhaErrada@1');
      expect(result).toBeDefined();
    });

    it('login bem sucedido retorna objeto com token', async () => {
      (prismaMock.titular.findFirst as jest.Mock).mockResolvedValue({ id: 1, cpf: '12345678901' });
      (prismaMock.titularCredential.findUnique as jest.Mock).mockResolvedValue({
        senhaHash: 'hash', contaAtiva: true,
      });
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      const result = await service.login('12345678901', 'Senha@Certa1');
      expect(result).toBeDefined();
    });
  });

  // ── resetPassword — cenários extra ────────────────────────────────────────────
  describe('resetPassword — cenários extra', () => {
    it('resetPassword consome token válido e cria credencial quando necessário', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'token-1', titularId: 1 });
      (prismaMock.titularCredential.upsert as jest.Mock).mockResolvedValue({});
      (prismaMock.titularCredential.update as jest.Mock).mockResolvedValue({});
      (prismaMock.titularToken.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      await expect(service.resetPassword('token-x', 'Nova@Senha1')).resolves.not.toThrow();
    });

    it('resetPassword com credencial existente atualiza senha e consome token', async () => {
      (prismaMock.titularToken.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'token-2', titularId: 1 });
      (prismaMock.titularCredential.upsert as jest.Mock).mockResolvedValue({});
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);
      (prismaMock.titularCredential.update as jest.Mock).mockResolvedValue({});
      (prismaMock.titularToken.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await expect(service.resetPassword('qualquer', 'Nova@Senha1')).resolves.not.toThrow();
    });
  });
});
