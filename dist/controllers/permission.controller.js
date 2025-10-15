"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionController = void 0;
const permission_service_1 = require("../services/permission.service");
const logger_1 = __importDefault(require("../utils/logger"));
class PermissionController {
    constructor() {
        this.logger = new logger_1.default({ service: 'PermissionController' });
    }
    async getAll(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new permission_service_1.PermissionService(req.tenantId);
            const result = await service.getAll();
            this.logger.info('getAll executed successfully', { tenant: req.tenantId });
            res.json(result);
        }
        catch (error) {
            this.logger.error('Failed to get all Permission', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async getById(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new permission_service_1.PermissionService(req.tenantId);
            const { id } = req.params;
            const result = await service.getById(Number(id));
            if (!result) {
                this.logger.warn(`Permission not found for id: ${id}`, { tenant: req.tenantId });
                return res.status(404).json({ message: 'Permission not found' });
            }
            this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.json(result);
        }
        catch (error) {
            this.logger.error(`Failed to get Permission by id`, error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async create(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new permission_service_1.PermissionService(req.tenantId);
            const data = req.body;
            const result = await service.create(data);
            this.logger.info('create executed successfully', { tenant: req.tenantId, data });
            res.status(201).json(result);
        }
        catch (error) {
            this.logger.error('Failed to create Permission', error, { body: req.body });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async update(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new permission_service_1.PermissionService(req.tenantId);
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
            this.logger.error(`Failed to update Permission`, error, {
                params: req.params,
                body: req.body,
            });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async delete(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new permission_service_1.PermissionService(req.tenantId);
            const { id } = req.params;
            await service.delete(Number(id));
            this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.status(204).send();
        }
        catch (error) {
            this.logger.error(`Failed to delete Permission`, error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}
exports.PermissionController = PermissionController;
