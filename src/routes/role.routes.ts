import { Router } from 'express';
import { RoleController } from '../controllers/role.controller';

const router = Router();
const controller = new RoleController();

router.get('/', controller.getAll.bind(controller));
router.get('/:id', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.delete.bind(controller));

router.put('/:id/permissions', controller.updatePermissions.bind(controller));

export default router;
