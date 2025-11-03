import { Router } from 'express';
import { PlanoController } from '../controllers/plano.controller';

const router = Router();
const controller = new PlanoController();

router.get('/', (req, res) => controller.getAll(req as any, res));
router.get('/:id', (req, res) => controller.getById(req as any, res));
router.post('/', (req, res) => controller.create(req as any, res));
router.put('/:id', (req, res) => controller.update(req as any, res));
router.delete('/:id', (req, res) => controller.delete(req as any, res));
router.post('/sugerir', (req, res) => controller.sugerir(req as any, res));
router.patch('/titulares/:titularId/plano', (req, res) => controller.vincularAoTitular(req as any, res));

export default router;
