import { Router } from 'express';
import { DocumentoController } from '../controllers/documento.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = Router();
const controller = new DocumentoController();

router.get('/', authenticate, authorize(['documento.view']), controller.getAll.bind(controller));
router.get('/:id', authenticate, authorize(['documento.view']), controller.getById.bind(controller));
router.post('/', authenticate, authorize(['documento.upload']), controller.create.bind(controller));
router.put('/:id', authenticate, authorize(['documento.upload']), controller.update.bind(controller));
router.delete('/:id', authenticate, authorize(['documento.delete']), controller.delete.bind(controller));

export default router;
