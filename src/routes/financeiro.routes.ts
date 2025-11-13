import { Router } from 'express';
import { FinanceiroController } from '../controllers/financeiro.controller';

const router = Router();
const controller = new FinanceiroController();

router.get('/contas', controller.getContas.bind(controller));
router.post('/contas/pagar', controller.createContaPagar.bind(controller));
router.post('/contas/receber', controller.createContaReceber.bind(controller));
router.post('/contas/:tipo/:id/baixa', controller.baixarConta.bind(controller));
router.post('/contas/:tipo/:id/estorno', controller.estornarConta.bind(controller));
router.get('/cadastros', controller.getCadastros.bind(controller));
router.post('/cadastros/bancos', controller.createBanco.bind(controller));
router.delete('/cadastros/bancos/:id', controller.deleteBanco.bind(controller));
router.post('/cadastros/tipos', controller.createTipoContabil.bind(controller));
router.delete('/cadastros/tipos/:id', controller.deleteTipoContabil.bind(controller));
router.post('/cadastros/formas', controller.createFormaPagamento.bind(controller));
router.delete('/cadastros/formas/:id', controller.deleteFormaPagamento.bind(controller));
router.post('/cadastros/centros', controller.createCentroResultado.bind(controller));
router.delete('/cadastros/centros/:id', controller.deleteCentroResultado.bind(controller));
router.get('/relatorios', controller.getRelatorioFinanceiro.bind(controller));

export default router;
