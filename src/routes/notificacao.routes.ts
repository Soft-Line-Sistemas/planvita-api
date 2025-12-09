import { Router } from 'express';
import { NotificacaoRecorrenteController } from '../controllers/notificacao-recorrente.controller';

const router = Router();
const controller = new NotificacaoRecorrenteController();

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

export default router;
