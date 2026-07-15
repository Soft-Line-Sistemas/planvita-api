import { Router } from 'express';
import { FinanceiroController } from '../controllers/financeiro.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { authenticateCliente } from '../middlewares/cliente-auth.middleware';

const router = Router();
const controller = new FinanceiroController();

router.get('/cliente/contas', authenticateCliente, controller.getContasCliente.bind(controller));
router.get('/contas', authenticate, controller.getContas.bind(controller));
router.post('/contas/pagar', authenticate, controller.createContaPagar.bind(controller));
router.post('/contas/receber', authenticate, controller.createContaReceber.bind(controller));
router.put('/contas/:tipo/:id', authenticate, controller.updateConta.bind(controller));
router.delete('/contas/:tipo/:id', authenticate, controller.deleteConta.bind(controller));
router.post('/contas/:tipo/:id/baixa', authenticate, controller.baixarConta.bind(controller));
router.post('/contas/:tipo/:id/estorno', authenticate, controller.estornarConta.bind(controller));
router.post('/contas/receber/:id/reconsulta', authenticate, controller.reconsultarContaReceber.bind(controller));
router.get('/cadastros', authenticate, controller.getCadastros.bind(controller));
router.post('/cadastros/bancos', authenticate, controller.createBanco.bind(controller));
router.delete('/cadastros/bancos/:id', authenticate, controller.deleteBanco.bind(controller));
router.post('/cadastros/tipos', authenticate, controller.createTipoContabil.bind(controller));
router.delete('/cadastros/tipos/:id', authenticate, controller.deleteTipoContabil.bind(controller));
router.post('/cadastros/formas', authenticate, controller.createFormaPagamento.bind(controller));
router.delete('/cadastros/formas/:id', authenticate, controller.deleteFormaPagamento.bind(controller));
router.post('/cadastros/centros', authenticate, controller.createCentroResultado.bind(controller));
router.delete('/cadastros/centros/:id', authenticate, controller.deleteCentroResultado.bind(controller));
router.get('/relatorios', authenticate, controller.getRelatorioFinanceiro.bind(controller));
router.get('/metricas/recorrencia', authenticate, controller.getMetricasRecorrencia.bind(controller));
router.get('/recorrencias', authenticate, controller.getRecorrencias.bind(controller));
router.post('/recorrencias/sincronizar', authenticate, controller.syncRecorrencias.bind(controller));
router.post('/asaas/sync-now', authenticate, controller.syncAsaasNow.bind(controller));
router.post(
  '/recorrencias/titular/:titularId/gerar',
  authenticate,
  controller.gerarRecorrenciaTitular.bind(controller),
);
router.post(
  '/recorrencias/titular/:titularId/cancelar',
  authenticate,
  controller.cancelarRecorrenciaTitular.bind(controller),
);

export default router;
