import express from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';

const router = express.Router();
const authController = new AuthController();

router.post('/login', authController.login.bind(authController));
router.post('/logout', authController.logout.bind(authController));

// router.get(
//   '/users',
//   authenticate,
//   authorize(['USERS_VIEW']), // exemplo de permissão pelo nome
//   (req, res) => {
//     res.json({ message: 'Você tem permissão para acessar!' });
//   },
// );

export default router;
