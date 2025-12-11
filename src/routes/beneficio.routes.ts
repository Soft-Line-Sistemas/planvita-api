import { Router } from 'express';
import { BeneficioController } from '../controllers/beneficio.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new BeneficioController();

router.get('/', authenticate, authorize(['beneficio.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['beneficio.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['beneficio.create']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['beneficio.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['beneficio.delete']), controller.delete.bind(controller));

export default router;
