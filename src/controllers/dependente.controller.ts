import { Request, Response } from 'express';
import { DependenteService } from '../services/dependente.service';
import Logger from '../utils/logger';

export class DependenteController {
  private service = new DependenteService();
  private logger = new Logger({ service: 'DependenteController' });

  async getAll(req: Request, res: Response) {
    try {
      const result = await this.service.getAll();
      this.logger.info('getAll executed successfully');
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all Dependente', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await this.service.getById(Number(id));
      if (!result) {
        this.logger.warn(`Dependente not found for id: ${id}`);
        return res.status(404).json({ message: 'Dependente not found' });
      }
      this.logger.info(`getById executed successfully for id: ${id}`);
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get Dependente by id`, error, { params: req.params });
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
      this.logger.error('Failed to create Dependente', error, { body: req.body });
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
      this.logger.error(`Failed to update Dependente`, error, { params: req.params, body: req.body });
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
      this.logger.error(`Failed to delete Dependente`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}
