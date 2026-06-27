import { Router } from 'express';
import { TitularController } from '../controllers/titular.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { authenticateAdminOrCliente, authenticateCliente } from '../middlewares/cliente-auth.middleware';

const router = Router();
const controller = new TitularController();

// Rota pública de busca por CPF (deve vir antes das rotas parametrizadas e não ter auth)
router.get('/public/search', controller.publicSearch.bind(controller));
router.get('/me', authenticateAdminOrCliente, controller.me.bind(controller));
router.put('/me/pagamento', authenticateCliente, controller.alterarPagamentoMe.bind(controller));
router.get('/me/foto/arquivo', authenticateCliente, controller.downloadFotoPerfilMe.bind(controller));
router.post('/me/foto', authenticateCliente, controller.uploadFotoPerfilMe.bind(controller));
router.delete('/me/foto', authenticateCliente, controller.deleteFotoPerfilMe.bind(controller));
router.delete('/me', authenticateCliente, controller.solicitarExclusaoConta.bind(controller));
router.get('/me/assinaturas', authenticateCliente, controller.getAssinaturasMe.bind(controller));
router.post('/me/assinaturas', authenticateCliente, controller.salvarAssinaturaMe.bind(controller));
router.get('/me/contrato/arquivo', authenticateCliente, controller.downloadContratoMe.bind(controller));
router.get(
  '/me/assinaturas/:assinaturaId/arquivo',
  authenticateCliente,
  controller.downloadAssinaturaMe.bind(controller),
);

router.get('/', authenticate, authorize(['titular.view']), controller.getAll.bind(controller));
router.get(
  '/export/cadastro',
  authenticate,
  authorize(['titular.view']),
  controller.exportCadastro.bind(controller),
);
router.post(
  '/sync-status-plano',
  authenticate,
  authorize(['titular.update']),
  controller.sincronizarStatusPlano.bind(controller),
);
router.get(
  '/:id/assinaturas',
  authenticate,
  authorize(['titular.view']),
  controller.getAssinaturas.bind(controller),
);
router.post(
  '/:id/assinaturas',
  authenticate,
  authorize(['titular.update']),
  controller.salvarAssinatura.bind(controller),
);
router.get(
  '/:id/assinaturas/:assinaturaId/arquivo',
  authenticate,
  authorize(['titular.view']),
  controller.downloadAssinatura.bind(controller),
);
router.get(
  '/:id/contrato/arquivo',
  authenticate,
  authorize(['titular.view']),
  controller.downloadContrato.bind(controller),
);
router.get('/:id', authenticate, authorize(['titular.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['titular.create']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['titular.update']), controller.update.bind(controller));
router.post(
  '/:id/sucessao-corresponsavel',
  authenticate,
  authorize(['titular.update']),
  controller.promoverCorresponsavel.bind(controller),
);
router.delete('/:id', authenticate, authorize(['titular.delete']), controller.delete.bind(controller));

router.post('/full', authenticate, authorize(['titular.create']), controller.createFull.bind(controller));

export default router;
