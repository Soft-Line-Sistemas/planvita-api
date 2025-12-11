import { Router } from 'express';
import { BeneficiarioTipoController } from '../controllers/beneficiariotipo.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new BeneficiarioTipoController();

router.get(
  '/',
  authenticate,
  authorize(['beneficiario_tipo.view']),
  controller.getAll.bind(controller),
);
router.get(
  '/:id',
  authenticate,
  authorize(['beneficiario_tipo.view']),
  controller.getById.bind(controller),
);
router.post(
  '/',
  authenticate,
  authorize(['beneficiario_tipo.create']),
  controller.create.bind(controller),
);
router.put(
  '/:id',
  authenticate,
  authorize(['beneficiario_tipo.update']),
  controller.update.bind(controller),
);
router.delete(
  '/:id',
  authenticate,
  authorize(['beneficiario_tipo.delete']),
  controller.delete.bind(controller),
);

export default router;
