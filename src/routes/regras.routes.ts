import { Router } from 'express';
import { RegrasController } from '../controllers/regras.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { authenticateCliente } from '../middlewares/cliente-auth.middleware';

const router = Router();
const controller = new RegrasController();

router.get('/public', controller.getPublicBosque.bind(controller));
router.get('/cliente', authenticateCliente, controller.getAll.bind(controller));
router.get('/operacional', authenticate, authorize(['titular.view']), controller.getAll.bind(controller));
router.get('/', authenticate, authorize(['regras.view']), controller.getAll.bind(controller));
router.get('/:tenantId', authenticate, authorize(['regras.view']), controller.getByTenant.bind(controller));
router.post('/', authenticate, authorize(['regras.update']), controller.create.bind(controller));
router.put('/:tenantId', authenticate, authorize(['regras.update']), controller.update.bind(controller));

export default router;
