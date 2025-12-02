import { Router } from 'express';
import { TitularController } from '../controllers/titular.controller';

const router = Router();
const controller = new TitularController();

router.get('/', controller.getAll.bind(controller));
router.get('/:id/assinaturas', controller.getAssinaturas.bind(controller));
router.post('/:id/assinaturas', controller.salvarAssinatura.bind(controller));
router.get(
  '/:id/assinaturas/:assinaturaId/arquivo',
  controller.downloadAssinatura.bind(controller),
);
router.get('/:id', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.delete.bind(controller));

router.post('/full', controller.createFull.bind(controller));

export default router;
