import bcrypt from 'bcryptjs';
import { ClienteAuthService } from './cliente-auth.service';

const prismaMock = {
  titularCredential: {
    findUnique: jest.fn(),
    update: jest.fn(),
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

describe('ClienteAuthService.changePassword', () => {
  let service: ClienteAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClienteAuthService('tenant-123');
  });

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

  it('deve rejeitar nova senha fraca', async () => {
    await expect(service.changePassword(10, 'SenhaAtual@1', '123')).rejects.toMatchObject({
      status: 400,
    });

    expect(prismaMock.titularCredential.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.titularCredential.update).not.toHaveBeenCalled();
  });
});
