import { Request, Response } from 'express';
import { UserService } from '../services/user.service';
import Logger from '../utils/logger';
import { PrismaClient } from '../../generated/prisma/client';
import { AuthRequest } from '../types/auth';

export interface TenantRequest extends Request {
  tenantId?: string;
  prisma?: PrismaClient;
}

type TenantAuthRequest = TenantRequest & AuthRequest;

export class UserController {
  private logger = new Logger({ service: 'UserController' });

  async getAll(req: TenantRequest, res: Response) {
    try {
      if (!req.tenantId) return res.status(400).json({ message: 'Tenant unknown' });

      const service = new UserService(req.tenantId);
      const result = await service.getAll();
      const formattedUsers = result.map((u) => ({
        id: u.id,
        name: u.nome,
        email: u.email,
        roleId: u.roles?.[0]?.role?.id ?? null,
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
      const { roleId } = req.body;

      if (!roleId) {
        return res.status(400).json({ message: 'roleId é obrigatório' });
      }

      const result = await service.updateUserRole(Number(userId), Number(roleId));
      this.logger.info(`updateUserRole executed for user ${userId} with role ${roleId}`, {
        tenant: req.tenantId,
      });
      res.json(result);
    } catch (error) {
      this.logger.error('Erro ao atualizar role do usuário', error, {
        params: req.params,
        body: req.body,
      });
      res.status(500).json({ message: 'Erro interno no servidor' });
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

      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };

      if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
        return res
          .status(400)
          .json({ message: 'A nova senha deve ter pelo menos 6 caracteres' });
      }

      const service = new UserService(req.tenantId);
      const existingUser = await service.getById(targetUserId);

      if (!existingUser) {
        this.logger.warn(`User not found for password update: ${targetUserId}`, {
          tenant: req.tenantId,
        });
        return res.status(404).json({ message: 'Usuário não encontrado' });
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
      res.status(500).json({ message: 'Erro interno no servidor' });
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
      res.status(500).json({ message: 'Erro interno no servidor' });
    }
  }
}
