import { Router } from 'express';
import { RoleController } from '../controllers/role.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new RoleController();

router.get('/', authenticate, authorize(['role.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['role.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['role.create']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['role.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['role.delete']), controller.delete.bind(controller));

router.put(
  '/:id/permissions',
  authenticate,
  authorize(['role.update']),
  controller.updatePermissions.bind(controller),
);

export default router;
