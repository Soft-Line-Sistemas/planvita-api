import { Request, Response } from 'express';
import { UserService } from '../services/user.service';
import Logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../types/auth';
import { isValidEmail } from '../utils/helpers';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

type TenantAuthRequest = TenantRequest & AuthRequest;

const AVATAR_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};
const AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB

function sanitizeAvatarFilename(name: string, mimeType: string) {
  const safeBase =
    name.replace(/[/\\\\]+/g, '').replace(/[^\w.-]/g, '_').slice(0, 80) || 'avatar';
  const desiredExt = AVATAR_MIME_TO_EXT[mimeType] || '';
  const hasValidExt = safeBase.toLowerCase().endsWith(desiredExt);
  return hasValidExt ? safeBase : `${safeBase}${desiredExt}`;
}

function estimateAvatarBase64Size(base64: string) {
  const clean = base64.split(',').pop() || '';
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return (clean.length * 3) / 4 - padding;
}

export class UserController {
  private logger = new Logger({ service: 'UserController' });

  private respondFromError(res: Response, error: unknown) {
    const candidate = error as { status?: number; code?: string; message?: string };
    if (candidate?.status) {
      return res.status(candidate.status).json({ message: candidate.message ?? 'Request failed' });
    }
    if (candidate?.code === 'P2025') {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    return res.status(500).json({ message: 'Erro interno no servidor' });
  }

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new UserService(req.tenantId);
      const result = await service.getAll();
      const formattedUsers = result.map((u) => ({
        id: u.id,
        name: u.nome,
        email: u.email,
        avatarUrl: (u as any).avatarUrl ?? null,
        roleId: u.roles?.[0]?.role?.id ?? null,
        consultorId: (u as any).consultor?.id ?? null,
        consultorCodigo: (u as any).consultor?.codigo ?? null,
        consultorWhatsapp: (u as any).consultor?.whatsapp ?? null,
        valorComissaoIndicacao: (u as any).consultor?.valorComissaoIndicacao ?? null,
        percentualComissaoIndicacao: (u as any).consultor?.percentualComissaoIndicacao ?? null,
        comissaoPendente: (u as any).consultor?.comissaoPendente ?? 0,
      }));

      this.logger.info('getAll executed successfully', { tenant: req.tenantId });
      res.json(formattedUsers);
    } catch (error) {
      this.logger.error('Failed to get all User', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new UserService(req.tenantId);
      const { id } = req.params;
      const result = await service.getById(Number(id));

      if (!result) {
        this.logger.warn(`User not found for id: ${id}`, { tenant: req.tenantId });
        return res.status(404).json({ message: 'User not found' });
      }

      this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get User by id', error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async create(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new UserService(req.tenantId);
      const data = req.body;
      const result = await service.create(data);

      this.logger.info('create executed successfully', { tenant: req.tenantId, data });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create User', error, { body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async update(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new UserService(req.tenantId);
      const { id } = req.params;
      const data = req.body;
      const result = await service.update(Number(id), data);

      this.logger.info(`update executed successfully for id: ${id}`, {
        tenant: req.tenantId,
        data,
      });
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to update User', error, { params: req.params, body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async delete(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new UserService(req.tenantId);
      const { id } = req.params;
      await service.delete(Number(id));

      this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
      res.status(204).send();
    } catch (error) {
      this.logger.error('Failed to delete User', error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async updateUserRole(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new UserService(req.tenantId);
      const { userId } = req.params;
      const {
        roleId,
        whatsapp,
        valorComissaoIndicacao,
        percentualComissaoIndicacao,
      } = req.body;

      if (!roleId) {
        return res.status(400).json({ message: 'roleId é obrigatório' });
      }

      const result = await service.updateUserRole(
        Number(userId),
        Number(roleId),
        whatsapp,
        valorComissaoIndicacao,
        percentualComissaoIndicacao,
      );
      this.logger.info(`updateUserRole executed for user ${userId} with role ${roleId}`, {
        tenant: req.tenantId,
      });
      res.json(result);
    } catch (error) {
      this.logger.error('Erro ao atualizar role do usuário', error, {
        params: req.params,
        body: req.body,
      });
      this.respondFromError(res, error);
    }
  }

  async changePassword(req: TenantAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      if (!req.user) return res.status(401).json({ message: 'Não autenticado' });

      const targetUserId = Number(req.params.id);
      if (Number.isNaN(targetUserId)) {
        return res.status(400).json({ message: 'ID de usuário inválido' });
      }

      const { currentPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
        password?: string;
      };

      const service = new UserService(req.tenantId);
      const existingUser = await service.getById(targetUserId);

      if (!existingUser) {
        this.logger.warn(`User not found for password update: ${targetUserId}`, {
          tenant: req.tenantId,
        });
        return res.status(404).json({ message: 'Usuário não encontrado' });
      }

      const payload = req.body as { newPassword?: string; password?: string };
      const rawNewPassword = payload.newPassword ?? payload.password;
      const newPassword =
        typeof rawNewPassword === 'string' ? rawNewPassword.trim() : rawNewPassword;

      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
        return res
          .status(400)
          .json({ message: 'A nova senha deve ter pelo menos 6 caracteres' });
      }

      const isSelf = req.user.id === targetUserId;
      const isAdmin = req.user.role?.name === 'admin_master';

      if (!isSelf && !isAdmin) {
        return res.status(403).json({ message: 'Permissão insuficiente' });
      }

      if (isSelf) {
        if (!currentPassword) {
          return res.status(400).json({ message: 'A senha atual é obrigatória' });
        }

        const isValidPassword = await service.verifyPassword(targetUserId, currentPassword);
        if (isValidPassword === null) {
          return res.status(404).json({ message: 'Usuário não encontrado' });
        }

        if (!isValidPassword) {
          return res.status(401).json({ message: 'Senha atual incorreta' });
        }
      }

      await service.updatePassword(targetUserId, newPassword);

      this.logger.info('Senha atualizada', {
        tenant: req.tenantId,
        targetUserId,
        requesterId: req.user.id,
      });

      res.json({
        message: isSelf ? 'Senha atualizada com sucesso' : 'Senha redefinida com sucesso',
      });
    } catch (error) {
      this.logger.error('Erro ao atualizar senha do usuário', error, {
        params: req.params,
        body: req.body,
      });
      this.respondFromError(res, error);
    }
  }

  async uploadAvatar(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const targetUserId = Number(req.params.id);
      if (Number.isNaN(targetUserId)) {
        return res.status(400).json({ message: 'ID de usuário inválido' });
      }

      const { fileBase64, filename, mimeType } = req.body ?? {};
      if (!fileBase64 || !filename || !mimeType) {
        return res
          .status(400)
          .json({ message: 'Campos fileBase64, filename e mimeType são obrigatórios' });
      }
      if (!AVATAR_ALLOWED_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ message: 'Tipo de arquivo não permitido' });
      }
      const size = estimateAvatarBase64Size(fileBase64);
      if (size > AVATAR_MAX_UPLOAD_BYTES) {
        return res.status(400).json({ message: 'Arquivo excede o limite de 5MB' });
      }

      const safeName = sanitizeAvatarFilename(filename, mimeType);
      const service = new UserService(req.tenantId);
      const updated = await service.updateAvatar(targetUserId, fileBase64, safeName, mimeType);

      this.logger.info('Avatar do colaborador atualizado', {
        tenant: req.tenantId,
        targetUserId,
      });

      res.json({ avatarUrl: (updated as any).avatarUrl ?? null });
    } catch (error) {
      this.logger.error('Erro ao atualizar avatar do colaborador', error, {
        params: req.params,
      });
      this.respondFromError(res, error);
    }
  }

  async downloadAvatar(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const targetUserId = Number(req.params.id);
      if (Number.isNaN(targetUserId)) {
        return res.status(400).json({ message: 'ID de usuário inválido' });
      }

      const service = new UserService(req.tenantId);
      const { buffer, mimetype } = await service.baixarAvatar(targetUserId);

      res.setHeader('Content-Type', mimetype);
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.send(buffer);
    } catch (error) {
      this.logger.error('Erro ao baixar avatar do colaborador', error, {
        params: req.params,
      });
      this.respondFromError(res, error);
    }
  }

  async removeAvatar(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const targetUserId = Number(req.params.id);
      if (Number.isNaN(targetUserId)) {
        return res.status(400).json({ message: 'ID de usuário inválido' });
      }

      const service = new UserService(req.tenantId);
      await service.removeAvatar(targetUserId);

      this.logger.info('Avatar do colaborador removido', {
        tenant: req.tenantId,
        targetUserId,
      });

      res.status(204).send();
    } catch (error) {
      this.logger.error('Erro ao remover avatar do colaborador', error, {
        params: req.params,
      });
      this.respondFromError(res, error);
    }
  }

  async changeEmail(req: TenantAuthRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });
      if (!req.user) return res.status(401).json({ message: 'Não autenticado' });

      const isAdmin = req.user.role?.name === 'admin_master';
      if (!isAdmin) {
        return res.status(403).json({ message: 'Permissão insuficiente' });
      }

      const targetUserId = Number(req.params.id);
      if (Number.isNaN(targetUserId)) {
        return res.status(400).json({ message: 'ID de usuário inválido' });
      }

      const { email } = req.body as { email?: string };
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({ message: 'E-mail é obrigatório' });
      }
      if (!isValidEmail(email.trim())) {
        return res.status(400).json({ message: 'E-mail inválido' });
      }

      const service = new UserService(req.tenantId);
      const updated = await service.updateEmail(targetUserId, email.trim());

      this.logger.info('Email atualizado por admin', {
        tenant: req.tenantId,
        targetUserId,
        requesterId: req.user.id,
      });

      res.json({
        message: 'E-mail atualizado com sucesso',
        user: {
          id: updated.id,
          nome: (updated as any).nome ?? undefined,
          email: updated.email,
        },
      });
    } catch (error) {
      this.logger.error('Erro ao atualizar e-mail do usuário', error, {
        params: req.params,
        body: req.body,
      });
      this.respondFromError(res, error);
    }
  }
}
