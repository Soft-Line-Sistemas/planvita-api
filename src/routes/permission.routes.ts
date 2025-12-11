import { Router } from 'express';
import { PermissionController } from '../controllers/permission.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new PermissionController();

router.get('/', authenticate, authorize(['permission.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['permission.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['role.update']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['role.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['role.update']), controller.delete.bind(controller));

export default router;
