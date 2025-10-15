"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthController = exports.HealthController = void 0;
const prisma_1 = require("../utils/prisma");
const logger_1 = require("../utils/logger");
const helpers_1 = require("../utils/helpers");
const config_1 = __importDefault(require("../config"));
class HealthController {
    constructor() {
        this.logger = new logger_1.Logger({ service: "health-controller" });
    }
    async healthCheck(req, res, next) {
        try {
            this.logger.info("Health check request received");
            const startTime = Date.now();
            const databaseHealth = await prisma_1.databaseManager.healthCheck();
            const overallStatus = databaseHealth ? "healthy" : "unhealthy";
            const healthResult = {
                status: overallStatus,
                timestamp: new Date(),
                services: {
                    database: databaseHealth ? "up" : "down",
                },
                version: config_1.default.server.apiVersion,
                uptime: process.uptime(),
            };
            const responseTime = Date.now() - startTime;
            this.logger.info("Health check completed", {
                status: overallStatus,
                responseTime: `${responseTime}ms`,
                database: databaseHealth ? "up" : "down",
            });
            const statusCode = overallStatus === "healthy" ? 200 : 503;
            res.status(statusCode).json((0, helpers_1.createSuccessResponse)(healthResult));
        }
        catch (error) {
            this.logger.error("Health check failed", error);
            const healthResult = {
                status: "unhealthy",
                timestamp: new Date(),
                services: {
                    database: "down",
                },
                version: config_1.default.server.apiVersion,
                uptime: process.uptime(),
            };
            res.status(503).json((0, helpers_1.createSuccessResponse)(healthResult));
        }
    }
    async livenessCheck(req, res, next) {
        try {
            this.logger.debug("Liveness check request received");
            res.json({
                alive: true,
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                pid: process.pid,
            });
        }
        catch (error) {
            this.logger.error("Liveness check failed", error);
            res.status(503).json({
                alive: false,
                reason: "Service is not responding properly",
            });
        }
    }
    async metricsCheck(req, res, next) {
        try {
            this.logger.info("Metrics check request received");
            const metrics = {
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
                pid: process.pid,
                version: config_1.default.server.apiVersion,
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch,
            };
            res.json((0, helpers_1.createSuccessResponse)(metrics));
        }
        catch (error) {
            this.logger.error("Metrics check failed", error);
            next(error);
        }
    }
}
exports.HealthController = HealthController;
exports.healthController = new HealthController();
