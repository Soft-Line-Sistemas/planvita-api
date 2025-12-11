import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new UserController();

router.get('/', authenticate, authorize(['user.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['user.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['user.create']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['user.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['user.delete']), controller.delete.bind(controller));
router.put(
  '/:id/password',
  authenticate,
  authorize(['user.update']),
  controller.changePassword.bind(controller),
);
router.put(
  '/:id/email',
  authenticate,
  authorize(['user.update']),
  controller.changeEmail.bind(controller),
);

router.put(
  '/:userId/role',
  authenticate,
  authorize(['user.assign_roles']),
  controller.updateUserRole.bind(controller),
);

export default router;
