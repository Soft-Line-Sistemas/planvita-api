import { Router } from 'express';
import { ConsultorController } from '../controllers/consultor.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new ConsultorController();

router.get('/', authenticate, authorize(['consultor.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['consultor.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['consultor.create']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['consultor.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['consultor.delete']), controller.delete.bind(controller));

export default router;
