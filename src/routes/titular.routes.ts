import { Router } from 'express';
import { TitularController } from '../controllers/titular.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new TitularController();

// Rota pública de busca por CPF (deve vir antes das rotas parametrizadas e não ter auth)
router.get('/public/search', controller.publicSearch.bind(controller));

router.get('/', authenticate, authorize(['titular.view']), controller.getAll.bind(controller));
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
router.get('/:id', authenticate, authorize(['titular.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['titular.create']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['titular.update']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['titular.delete']), controller.delete.bind(controller));

router.post('/full', authenticate, authorize(['titular.create']), controller.createFull.bind(controller));

export default router;
