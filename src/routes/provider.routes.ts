import { Router } from 'express';
import { ProviderController } from '../controllers/provider.controller';

const router = Router();
const controller = new ProviderController();

router.get('/asaas/payments', controller.getAsaasPayments.bind(controller));

export default router;

