import { Router } from 'express';
import { RegrasController } from '../controllers/regras.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
const controller = new RegrasController();

router.get('/', controller.getAll.bind(controller));
router.get('/:tenantId', controller.getByTenant.bind(controller));
router.post('/', authenticate, controller.create.bind(controller));
router.put('/:tenantId', authenticate, controller.update.bind(controller));

export default router;
