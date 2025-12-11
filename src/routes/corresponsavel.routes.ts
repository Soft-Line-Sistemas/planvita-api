import { Router } from 'express';
import { CorresponsavelController } from '../controllers/corresponsavel.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new CorresponsavelController();

router.get('/', authenticate, authorize(['titular.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['titular.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['corresponsavel.create']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['corresponsavel.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['corresponsavel.delete']), controller.delete.bind(controller));

export default router;
