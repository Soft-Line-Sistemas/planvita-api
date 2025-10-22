import { Router } from 'express';
import { LayoutConfigController } from '../controllers/layoutconfig.controller';

const router = Router();
const controller = new LayoutConfigController();

router.get('/', controller.getAll.bind(controller));
router.get('/css', controller.getLayoutCss.bind(controller));
router.get('/:id/get', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.delete.bind(controller));

export default router;
