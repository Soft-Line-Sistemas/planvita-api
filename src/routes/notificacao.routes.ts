import { Router } from 'express';
import { NotificacaoRecorrenteController } from '../controllers/notificacao-recorrente.controller';
import { NotificacaoWhatsappController } from '../controllers/notificacao-whatsapp.controller';

const router = Router();
const controller = new NotificacaoRecorrenteController();
const whatsappController = new NotificacaoWhatsappController();

router.get('/recorrentes/painel', controller.getPainel.bind(controller));
router.post('/recorrentes/disparar', controller.disparar.bind(controller));
router.patch('/recorrentes/agendamento', controller.atualizarAgendamento.bind(controller));
router.patch(
  '/recorrentes/clientes/:titularId/bloqueio',
  controller.atualizarBloqueio.bind(controller),
);
router.patch(
  '/recorrentes/clientes/:titularId/metodo',
  controller.atualizarMetodo.bind(controller),
);
router.get('/recorrentes/logs', controller.getLogs.bind(controller));
router.get('/whatsapp', whatsappController.getOverview.bind(whatsappController));
router.get('/whatsapp/qr', whatsappController.getQr.bind(whatsappController));
router.get('/whatsapp/queue', whatsappController.getQueue.bind(whatsappController));
router.post('/whatsapp/disconnect', whatsappController.disconnect.bind(whatsappController));
router.post('/whatsapp/test', whatsappController.sendTest.bind(whatsappController));
router.put('/whatsapp/config', whatsappController.updateConfig.bind(whatsappController));

export default router;
