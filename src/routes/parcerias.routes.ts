import { Router } from 'express';
import { ParceriasController } from '../controllers/parcerias.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { authenticateAdminOrCliente, authenticateCliente } from '../middlewares/cliente-auth.middleware';

const router = Router();
const controller = new ParceriasController();

router.get('/categorias', authenticate, authorize(['parcerias.view']), controller.listarCategoriasAdmin.bind(controller));
router.post('/categorias', authenticate, authorize(['parcerias.create', 'parcerias.update']), controller.salvarCategoria.bind(controller));

router.get('/parceiros', authenticate, authorize(['parcerias.view']), controller.listarParceirosAdmin.bind(controller));
router.post('/parceiros', authenticate, authorize(['parcerias.create', 'parcerias.update']), controller.salvarParceiro.bind(controller));

router.get('/vantagens', authenticate, authorize(['parcerias.view']), controller.listarVantagensAdmin.bind(controller));
router.post('/vantagens', authenticate, authorize(['parcerias.create', 'parcerias.update']), controller.salvarVantagem.bind(controller));
router.delete('/vantagens/:id', authenticate, authorize(['parcerias.delete']), controller.excluirVantagem.bind(controller));

router.get('/cliente/categorias', authenticateAdminOrCliente, controller.listarCategoriasCliente.bind(controller));
router.get('/cliente/vantagens', authenticateAdminOrCliente, controller.listarVantagensCliente.bind(controller));
router.get('/cliente/vantagens/:slug', authenticateAdminOrCliente, controller.obterVantagemCliente.bind(controller));
router.post('/cliente/vantagens/:id/resgates', authenticateAdminOrCliente, controller.registrarResgate.bind(controller));

router.get('/public/vantagens', controller.listarVantagensPublicas.bind(controller));

export default router;
