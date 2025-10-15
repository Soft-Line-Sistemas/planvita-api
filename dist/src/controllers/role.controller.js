"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoleController = void 0;
const role_service_1 = require("../services/role.service");
const logger_1 = __importDefault(require("../utils/logger"));
class RoleController {
    constructor() {
        this.logger = new logger_1.default({ service: 'RoleController' });
    }
    async getAll(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new role_service_1.RoleService(req.tenantId);
            const result = await service.getAll();
            const formattedRoles = result.map((r) => ({
                id: r.id,
                name: r.name,
                permissions: r.RolePermission.map((rp) => rp.permissionId),
            }));
            this.logger.info('getAll executed successfully', { tenant: req.tenantId });
            res.json(formattedRoles);
        }
        catch (error) {
            this.logger.error('Failed to get all Role', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async getById(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new role_service_1.RoleService(req.tenantId);
            const { id } = req.params;
            const result = await service.getById(Number(id));
            if (!result) {
                this.logger.warn(`Role not found for id: ${id}`, { tenant: req.tenantId });
                return res.status(404).json({ message: 'Role not found' });
            }
            this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.json(result);
        }
        catch (error) {
            this.logger.error('Failed to get Role by id', error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async create(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new role_service_1.RoleService(req.tenantId);
            const data = req.body;
            const result = await service.create(data);
            this.logger.info('create executed successfully', { tenant: req.tenantId, data });
            res.status(201).json(result);
        }
        catch (error) {
            this.logger.error('Failed to create Role', error, { body: req.body });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async update(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new role_service_1.RoleService(req.tenantId);
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
            this.logger.error('Failed to update Role', error, { params: req.params, body: req.body });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async delete(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new role_service_1.RoleService(req.tenantId);
            const { id } = req.params;
            await service.delete(Number(id));
            this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.status(204).send();
        }
        catch (error) {
            this.logger.error('Failed to delete Role', error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async updatePermissions(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new role_service_1.RoleService(req.tenantId);
            const { id } = req.params;
            const { permissionIds } = req.body;
            if (!Array.isArray(permissionIds)) {
                return res.status(400).json({ message: 'permissionIds deve ser um array' });
            }
            const result = await service.updatePermissions(Number(id), permissionIds);
            this.logger.info(`updatePermissions executado para role ${id}`, {
                tenant: req.tenantId,
                permissionIds,
            });
            res.json(result);
        }
        catch (error) {
            this.logger.error('Erro ao atualizar permissões da role', error, {
                params: req.params,
                body: req.body,
            });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}
exports.RoleController = RoleController;
