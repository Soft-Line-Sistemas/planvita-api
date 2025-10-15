"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = express_1.default.Router();
const authController = new auth_controller_1.AuthController();
router.post('/login', authController.login.bind(authController));
router.post('/logout', authController.logout.bind(authController));
router.get('/check', auth_middleware_1.authenticate);
// router.get(
//   '/users',
//   authenticate,
//   authorize(['USERS_VIEW']), // exemplo de permissão pelo nome
//   (req, res) => {
//     res.json({ message: 'Você tem permissão para acessar!' });
//   },
// );
exports.default = router;
