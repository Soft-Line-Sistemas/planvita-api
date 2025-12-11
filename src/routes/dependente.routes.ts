import { Router } from 'express';
import { DependenteController } from '../controllers/dependente.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new DependenteController();

router.get('/', authenticate, authorize(['titular.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['titular.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['dependente.create']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['dependente.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['dependente.delete']), controller.delete.bind(controller));

export default router;
