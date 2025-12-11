import { Router } from 'express';
import { PagamentoController } from '../controllers/pagamento.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new PagamentoController();

router.get('/', authenticate, authorize(['pagamento.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['pagamento.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['pagamento.create']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['pagamento.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['pagamento.delete']), controller.delete.bind(controller));

export default router;
