"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeyController = void 0;
const apikey_service_1 = require("../services/apikey.service");
const logger_1 = __importDefault(require("../utils/logger"));
class ApiKeyController {
    constructor() {
        this.logger = new logger_1.default({ service: 'ApiKeyController' });
    }
    async getAll(req, res) {
        try {
            if (!req.tenantId) {
                return res.status(400).json({ message: 'Tenant unknown' });
            }
            const service = new apikey_service_1.ApiKeyService(req.tenantId);
            const result = await service.getAll();
            this.logger.info('getAll executed successfully', { tenant: req.tenantId });
            res.json(result);
        }
        catch (error) {
            this.logger.error('Failed to get all ApiKey', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async getById(req, res) {
        try {
            if (!req.tenantId) {
                return res.status(400).json({ message: 'Tenant unknown' });
            }
            const { id } = req.params;
            const service = new apikey_service_1.ApiKeyService(req.tenantId);
            const result = await service.getById(Number(id));
            if (!result) {
                this.logger.warn(`ApiKey not found for id: ${id}`);
                return res.status(404).json({ message: 'ApiKey not found' });
            }
            this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.json(result);
        }
        catch (error) {
            this.logger.error(`Failed to get ApiKey by id`, error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async create(req, res) {
        try {
            if (!req.tenantId) {
                return res.status(400).json({ message: 'Tenant unknown' });
            }
            const service = new apikey_service_1.ApiKeyService(req.tenantId);
            const data = req.body;
            const result = await service.create(data);
            this.logger.info('create executed successfully', { data, tenant: req.tenantId });
            res.status(201).json(result);
        }
        catch (error) {
            this.logger.error('Failed to create ApiKey', error, { body: req.body });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async update(req, res) {
        try {
            if (!req.tenantId) {
                return res.status(400).json({ message: 'Tenant unknown' });
            }
            const { id } = req.params;
            const service = new apikey_service_1.ApiKeyService(req.tenantId);
            const data = req.body;
            const result = await service.update(Number(id), data);
            this.logger.info(`update executed successfully for id: ${id}`, {
                data,
                tenant: req.tenantId,
            });
            res.json(result);
        }
        catch (error) {
            this.logger.error(`Failed to update ApiKey`, error, { params: req.params, body: req.body });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async delete(req, res) {
        try {
            if (!req.tenantId) {
                return res.status(400).json({ message: 'Tenant unknown' });
            }
            const { id } = req.params;
            const service = new apikey_service_1.ApiKeyService(req.tenantId);
            await service.delete(Number(id));
            this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.status(204).send();
        }
        catch (error) {
            this.logger.error(`Failed to delete ApiKey`, error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}
exports.ApiKeyController = ApiKeyController;
