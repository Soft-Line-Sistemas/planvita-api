import { Router } from 'express';
import { NotificacaoTemplateController } from '../controllers/notificacao-template.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
const controller = new NotificacaoTemplateController();

router.get('/', authenticate, controller.listar.bind(controller));
router.post('/', authenticate, controller.criar.bind(controller));
router.put('/:id', authenticate, controller.atualizar.bind(controller));
router.delete('/:id', authenticate, controller.remover.bind(controller));
router.post('/upload', authenticate, controller.upload.bind(controller));

export default router;
