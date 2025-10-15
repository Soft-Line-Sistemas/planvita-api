"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
exports.startServer = startServer;
const prisma_1 = require("../utils/prisma");
const logger_1 = require("./logger");
const config_1 = __importDefault(require("../config"));
const logger = new logger_1.Logger({ service: 'main' });
let server;
async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    // Stop accepting new connections
    server.close(async (error) => {
        if (error) {
            logger.error('Error during server shutdown', error);
            process.exit(1);
        }
        try {
            // Disconnect from database
            await prisma_1.databaseManager.disconnect();
            logger.info('Database disconnected successfully');
            logger.info('Graceful shutdown completed');
            process.exit(0);
        }
        catch (shutdownError) {
            logger.error('Error during graceful shutdown', shutdownError);
            process.exit(1);
        }
    });
    // Force shutdown after 30 seconds
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);
}
async function startServer(app) {
    try {
        // Connect to database
        await prisma_1.databaseManager.connect();
        logger.info('Database connected successfully');
        // Start HTTP server
        exports.server = server = app.listen(config_1.default.server.port, '0.0.0.0', () => {
            logger.info('VitalSoft API started successfully', {
                port: config_1.default.server.port,
                nodeEnv: config_1.default.server.nodeEnv,
                version: config_1.default.server.apiVersion,
                pid: process.pid,
            });
            logger.info('Available endpoints:', {
                api: `http://localhost:${config_1.default.server.port}/api/v1`,
                health: `http://localhost:${config_1.default.server.port}/health`,
                // docs: `http://localhost:${config.server.port}/api-docs`,
            });
        });
        // Handle server errors
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                logger.error(`Port ${config_1.default.server.port} is already in use`);
            }
            else {
                logger.error('Server error occurred', error);
            }
            process.exit(1);
        });
        // Graceful shutdown handlers
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        return server;
    }
    catch (error) {
        logger.error('Failed to start server', error);
        process.exit(1);
    }
}
