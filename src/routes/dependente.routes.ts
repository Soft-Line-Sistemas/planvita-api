import { Router } from 'express';
import { DependenteController } from '../controllers/dependente.controller';

const router = Router();
const controller = new DependenteController();

router.get('/', controller.getAll.bind(controller));
router.get('/:id', controller.getById.bind(controller));
router.post('/', controller.create.bind(controller));
router.put('/:id', controller.update.bind(controller));
router.delete('/:id', controller.delete.bind(controller));

export default router;
