"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentoController = void 0;
const documento_service_1 = require("../services/documento.service");
const logger_1 = __importDefault(require("../utils/logger"));
class DocumentoController {
    constructor() {
        this.logger = new logger_1.default({ service: 'DocumentoController' });
    }
    async getAll(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new documento_service_1.DocumentoService(req.tenantId);
            const result = await service.getAll();
            this.logger.info('getAll executed successfully', { tenant: req.tenantId });
            res.json(result);
        }
        catch (error) {
            this.logger.error('Failed to get all Documento', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async getById(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new documento_service_1.DocumentoService(req.tenantId);
            const { id } = req.params;
            const result = await service.getById(Number(id));
            if (!result) {
                this.logger.warn(`Documento not found for id: ${id}`, { tenant: req.tenantId });
                return res.status(404).json({ message: 'Documento not found' });
            }
            this.logger.info(`getById executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.json(result);
        }
        catch (error) {
            this.logger.error(`Failed to get Documento by id`, error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async create(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new documento_service_1.DocumentoService(req.tenantId);
            const data = req.body;
            const result = await service.create(data);
            this.logger.info('create executed successfully', { tenant: req.tenantId, data });
            res.status(201).json(result);
        }
        catch (error) {
            this.logger.error('Failed to create Documento', error, { body: req.body });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
    async update(req, res) {
        try {
            if (!req.tenantId)
                return res.status(400).json({ message: 'Tenant unknown' });
            const service = new documento_service_1.DocumentoService(req.tenantId);
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
            this.logger.error(`Failed to update Documento`, error, {
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
            const service = new documento_service_1.DocumentoService(req.tenantId);
            const { id } = req.params;
            await service.delete(Number(id));
            this.logger.info(`delete executed successfully for id: ${id}`, { tenant: req.tenantId });
            res.status(204).send();
        }
        catch (error) {
            this.logger.error(`Failed to delete Documento`, error, { params: req.params });
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}
exports.DocumentoController = DocumentoController;
