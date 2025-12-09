import { Router } from 'express';
import { NotificacaoTemplateController } from '../controllers/notificacao-template.controller';

const router = Router();
const controller = new NotificacaoTemplateController();

router.get('/', controller.listar.bind(controller));
router.post('/', controller.criar.bind(controller));
router.put('/:id', controller.atualizar.bind(controller));
router.delete('/:id', controller.remover.bind(controller));
router.post('/upload', controller.upload.bind(controller));

export default router;
