"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserController = void 0;
const user_service_1 = require("../services/user.service");
const logger_1 = __importDefault(require("../utils/logger"));
class UserController {
    constructor() {
        this.logger = new logger_1.default({ service: 'UserController' });
    }
    async getAll(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new user_service_1.UserService(req.tenantId);
            const result = await service.getAll();
            const formattedUsers = result.map((u) => ({
                id: u.id,
                name: u.nome,
                email: u.email,
                roleId: u.roles?.[0]?.role?.id ?? null,
            }));
            this.logger.info('getAll executed successfully', { tenant: req.tenantId });
            res.json(formattedUsers);
        }
        catch (error) {
            this.logger.error('Failed to get all User', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async getById(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new user_service_1.UserService(req.tenantId);
            const { id } = req.params;
            const result = await service.getById(Number(id));
            if (!result) {
                this.logger.warn(`User not found for id: ${id}`, { tenant: req.tenantId });
                return res.status(404).json({ message: 'User not found' });
            }
            this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.json(result);
        }
        catch (error) {
            this.logger.error('Failed to get User by id', error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async create(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new user_service_1.UserService(req.tenantId);
            const data = req.body;
            const result = await service.create(data);
            this.logger.info('create executed successfully', { tenant: req.tenantId, data });
            res.status(201).json(result);
        }
        catch (error) {
            this.logger.error('Failed to create User', error, { body: req.body });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async update(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new user_service_1.UserService(req.tenantId);
            const { id } = req.params;
            const data = req.body;
            const result = await service.update(Number(id), data);
            this.logger.info(`update executed successfully for id: ${id}`, {
                tenant: req.tenantId,
                data,
            });
            res.json(result);
        }
        catch (error) {
            this.logger.error('Failed to update User', error, { params: req.params, body: req.body });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async delete(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new user_service_1.UserService(req.tenantId);
            const { id } = req.params;
            await service.delete(Number(id));
            this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.status(204).send();
        }
        catch (error) {
            this.logger.error('Failed to delete User', error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async updateUserRole(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new user_service_1.UserService(req.tenantId);
            const { userId } = req.params;
            const { roleId } = req.body;
            if (!roleId) {
                return res.status(400).json({ message: 'roleId é obrigatório' });
            }
            const result = await service.updateUserRole(Number(userId), Number(roleId));
            this.logger.info(`updateUserRole executed for user ${userId} with role ${roleId}`, {
                tenant: req.tenantId,
            });
            res.json(result);
        }
        catch (error) {
            this.logger.error('Erro ao atualizar role do usuário', error, {
                params: req.params,
                body: req.body,
            });
            res.status(500).json({ message: 'Erro interno no servidor' });
        }
    }
}
exports.UserController = UserController;
