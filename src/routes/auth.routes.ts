import express from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { authenticateCliente } from '../middlewares/cliente-auth.middleware';

const router = express.Router();
const authController = new AuthController();

router.post('/login', authController.login.bind(authController));
router.post('/pagamento/reenviar', authController.reenviarLinkPagamento.bind(authController));
router.post('/register', authController.register.bind(authController));
router.post('/verify', authController.verify.bind(authController));
router.post('/first-access', authController.firstAccess.bind(authController));
router.post('/forgot-password', authController.forgotPassword.bind(authController));
router.post('/reset-password', authController.resetPassword.bind(authController));
router.post(
  '/cliente/change-password',
  authenticateCliente,
  authController.changeClientePassword.bind(authController),
);
router.post('/logout', authController.logout.bind(authController));
router.get('/check', authenticate, authController.check.bind(authController));
router.post(
  '/contrato/reenviar-link',
  authenticateCliente,
  authController.reenviarLinkContrato.bind(authController),
);

export default router;
