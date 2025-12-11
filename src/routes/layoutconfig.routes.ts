import { Router } from 'express';
import { LayoutConfigController } from '../controllers/layoutconfig.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new LayoutConfigController();

router.get('/', authenticate, authorize(['layout.view']), controller.getAll.bind(controller));
router.get('/css', authenticate, authorize(['layout.view']), controller.getLayoutCss.bind(controller));
router.get('/:id/get', authenticate, authorize(['layout.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['layout.update']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['layout.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['layout.update']), controller.delete.bind(controller));

export default router;
