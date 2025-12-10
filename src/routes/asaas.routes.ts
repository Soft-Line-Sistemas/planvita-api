import { Router } from 'express';
import { AsaasController } from '../controllers/asaas.controller';

const router = Router();
const controller = new AsaasController();

router.post('/webhook', controller.handleWebhook.bind(controller));

export default router;
