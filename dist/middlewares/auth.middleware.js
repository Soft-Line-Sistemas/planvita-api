"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.authorize = authorize;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
function authenticate(req, res, next) {
    const token = req.cookies.auth_token;
    console.log(req.cookies);
    if (!token)
        return res.status(401).json({ message: 'Não autenticado' });
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch {
        return res.status(401).json({ message: 'Token inválido' });
    }
}
function authorize(requiredPermissions) {
    return (req, res, next) => {
        const userPermissions = req.user?.permissions || [];
        const hasPermission = requiredPermissions.every((p) => userPermissions.includes(p));
        if (!hasPermission) {
            return res.status(403).json({ message: 'Permissão insuficiente' });
        }
        next();
    };
}
