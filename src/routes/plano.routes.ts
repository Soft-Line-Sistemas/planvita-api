import { Router } from 'express';
import { PlanoController } from '../controllers/plano.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new PlanoController();

router.get('/', authenticate, (req, res) => controller.getAll(req as any, res));
router.get('/:id', authenticate, (req, res) => controller.getById(req as any, res));
router.post('/', authenticate, authorize(['plano.create']), (req, res) =>
  controller.create(req as any, res),
);
router.put('/:id', authenticate, authorize(['plano.update']), (req, res) =>
  controller.update(req as any, res),
);
router.delete('/:id', authenticate, authorize(['plano.delete']), (req, res) =>
  controller.delete(req as any, res),
);
router.post('/sugerir', authenticate, (req, res) => controller.sugerir(req as any, res));
router.patch(
  '/titulares/:titularId/plano',
  authenticate,
  authorize(['plano.update']),
  (req, res) => controller.vincularAoTitular(req as any, res),
);

export default router;
