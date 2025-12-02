import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
const controller = new UserController();

router.get('/', controller.getAll.bind(controller));
router.get('/:id', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.delete.bind(controller));
router.put('/:id/password', authenticate, controller.changePassword.bind(controller));
router.put('/:id/email', authenticate, controller.changeEmail.bind(controller));

router.put('/:userId/role', controller.updateUserRole.bind(controller));

export default router;
