import { Router } from 'express';
import { PagamentoController } from '../controllers/pagamento.controller';

const router = Router();
const controller = new PagamentoController();

router.get('/', controller.getAll.bind(controller));
router.get('/:id', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.delete.bind(controller));

export default router;
