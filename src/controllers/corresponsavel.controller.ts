import { Request, Response } from 'express';
import { CorresponsavelService } from '../services/corresponsavel.service';
import Logger from '../utils/logger';

export class CorresponsavelController {
  private service = new CorresponsavelService();
  private logger = new Logger({ service: 'CorresponsavelController' });

  async getAll(req: Request, res: Response) {
    try {
      const result = await this.service.getAll();
      this.logger.info('getAll executed successfully');
      res.json(result);
    } catch (error) {
      this.logger.error('Failed to get all Corresponsavel', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const result = await this.service.getById(Number(id));
      if (!result) {
        this.logger.warn(`Corresponsavel not found for id: ${id}`);
        return res.status(404).json({ message: 'Corresponsavel not found' });
      }
      this.logger.info(`getById executed successfully for id: ${id}`);
      res.json(result);
    } catch (error) {
      this.logger.error(`Failed to get Corresponsavel by id`, error, { params: req.params });
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
      this.logger.error('Failed to create Corresponsavel', error, { body: req.body });
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
      this.logger.error(`Failed to update Corresponsavel`, error, { params: req.params, body: req.body });
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
      this.logger.error(`Failed to delete Corresponsavel`, error, { params: req.params });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}
