import { Router } from 'express';
import { ComissaoController } from '../controllers/comissao.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new ComissaoController();

router.get('/', authenticate, authorize(['comissao.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['comissao.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['comissao.generate']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['comissao.pay']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['comissao.generate']), controller.delete.bind(controller));

export default router;
