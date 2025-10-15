"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const auth_service_1 = require("../services/auth.service");
const logger_1 = __importDefault(require("../utils/logger"));
class AuthController {
    constructor() {
        this.logger = new logger_1.default({ service: 'AuthController' });
    }
    async login(req, res) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                res.status(400).json({ message: 'Email e senha são obrigatórios' });
                return;
            }
            if (!req.tenantId) {
                res.status(400).json({ message: 'Tenant unknown' });
                return;
            }
            const service = new auth_service_1.AuthService(req.tenantId);
            const user = await service.validateUser(email, password);
            if (!user)
                return res.status(401).json({ message: 'Credenciais inválidas' });
            const token = service.generateToken(user);
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
                domain: process.env.NODE_ENV === 'production' ? '.planvita.com.br' : undefined,
                maxAge: 1000 * 60 * 60 * 24, // 1 dia
            });
            res.json(user);
        }
        catch (error) {
            this.logger.error('Erro ao realizar login', error);
            res.status(500).json({ message: 'Erro interno no servidor' });
        }
    }
    async logout(req, res) {
        res.cookie('auth_token', '', { maxAge: -1 });
        res.json({ message: 'Logout realizado com sucesso' });
    }
}
exports.AuthController = AuthController;
