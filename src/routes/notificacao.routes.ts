import { Router } from 'express';
import { NotificacaoRecorrenteController } from '../controllers/notificacao-recorrente.controller';
import { NotificacaoWhatsappController } from '../controllers/notificacao-whatsapp.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();
const controller = new NotificacaoRecorrenteController();
const whatsappController = new NotificacaoWhatsappController();

router.get('/recorrentes/painel', authenticate, controller.getPainel.bind(controller));
router.post('/recorrentes/disparar', authenticate, controller.disparar.bind(controller));
router.patch('/recorrentes/agendamento', authenticate, controller.atualizarAgendamento.bind(controller));
router.patch(
  '/recorrentes/clientes/:titularId/bloqueio',
  authenticate,
  controller.atualizarBloqueio.bind(controller),
);
router.patch(
  '/recorrentes/clientes/:titularId/metodo',
  authenticate,
  controller.atualizarMetodo.bind(controller),
);
router.get('/recorrentes/logs', authenticate, controller.getLogs.bind(controller));
router.get('/whatsapp', authenticate, whatsappController.getOverview.bind(whatsappController));
router.get('/whatsapp/qr', authenticate, whatsappController.getQr.bind(whatsappController));
router.get('/whatsapp/queue', authenticate, whatsappController.getQueue.bind(whatsappController));
router.post(
  '/whatsapp/disconnect',
  authenticate,
  whatsappController.disconnect.bind(whatsappController),
);
router.post('/whatsapp/test', authenticate, whatsappController.sendTest.bind(whatsappController));
router.put('/whatsapp/config', authenticate, whatsappController.updateConfig.bind(whatsappController));

export default router;
