import { Request, Response } from 'express';
import { RoleService } from '../services/role.service';
import Logger from '../utils/logger';

export class RoleController {
  private service = new RoleService();
  private logger = new Logger({ service: 'RoleController' });

  async getAll(req: Request, res: Response) {
    try {
      const result = await this.service.getAll();
      this.logger.info('getAll executed successfully');
      const formattedRoles = result.map((r) => ({
        id: r.id,
        name: r.name,
        permissions: r.RolePermission.map((rp) => rp.permissionId),
      }));
      res.json(formattedRoles);
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all Role', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await this.service.getById(Number(id));
      if (!result) {
        this.logger.warn(`Role not found for id: ${id}`);
        return res.status(404).json({ message: 'Role not found' });
      }
      this.logger.info(`getById executed successfully for id: ${id}`);
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get Role by id`, error, { params: req.params });
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
      this.logger.error('Failed to create Role', error, { body: req.body });
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
      this.logger.error(`Failed to update Role`, error, { params: req.params, body: req.body });
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
      this.logger.error(`Failed to delete Role`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async updatePermissions(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { permissionIds } = req.body;

      if (!Array.isArray(permissionIds)) {
        return res.status(400).json({ message: 'permissionIds deve ser um array' });
      }

      const result = await this.service.updatePermissions(Number(id), permissionIds);
      this.logger.info(`updatePermissions executado para role ${id}`, { permissionIds });
      res.json(result);
    } catch (error) {
      this.logger.error('Erro ao atualizar permissões da role', error, {
        params: req.params,
        body: req.body,
      });
      res.status(500).json({ message: 'Erro interno no servidor' });
    }
  }
}
