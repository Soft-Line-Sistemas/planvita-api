import { Request, Response } from 'express';
import { UserService } from '../services/user.service';
import Logger from '../utils/logger';

export class UserController {
  private service = new UserService();
  private logger = new Logger({ service: 'UserController' });

  async getAll(req: Request, res: Response) {
    try {
      const result = await this.service.getAll();
      const formattedUsers = result.map((u) => ({
        id: u.id,
        name: u.nome,
        email: u.email,
        roleId: u.roles?.[0]?.role?.id ?? null,
      }));
      res.json(formattedUsers);
    } catch (error) {
      this.logger.error('Failed to get all User', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await this.service.getById(Number(id));
      if (!result) {
        this.logger.warn(`User not found for id: ${id}`);
        return res.status(404).json({ message: 'User not found' });
      }
      this.logger.info(`getById executed successfully for id: ${id}`);
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get User by id`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const data = req.body;
      const result = await this.service.create(data);
      this.logger.info('create executed successfully', { data });
      res.status(201).json(result);
    } catch (error) {
      this.logger.error('Failed to create User', error, { body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const data = req.body;
      const result = await this.service.update(Number(id), data);
      this.logger.info(`update executed successfully for id: ${id}`, { data });
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to update User`, error, { params: req.params, body: req.body });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await this.service.delete(Number(id));
      this.logger.info(`delete executed successfully for id: ${id}`);
      res.status(204).send();
    } catch (error) {
      this.logger.error(`Failed to delete User`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async updateUserRole(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      const { roleId } = req.body;

      if (!roleId) {
        return res.status(400).json({ message: 'roleId é obrigatório' });
      }

      const result = await this.service.updateUserRole(Number(userId), Number(roleId));
      this.logger.info(`updateUserRole executado para usuário ${userId} com role ${roleId}`);
      res.json(result);
    } catch (error) {
      this.logger.error('Erro ao atualizar role do usuário', error, {
        params: req.params,
        body: req.body,
      });
      res.status(500).json({ message: 'Erro interno no servidor' });
    }
  }
}
