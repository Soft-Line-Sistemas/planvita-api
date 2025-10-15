"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.winstonLogger = exports.defaultLogger = exports.Logger = void 0;
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
// Ensure logs directory exists
const logsDir = path_1.default.dirname(config_1.config.logFile);
if (!fs_1.default.existsSync(logsDir)) {
    fs_1.default.mkdirSync(logsDir, { recursive: true });
}
// Custom format for structured logging
const customFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss.SSS",
}), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json(), winston_1.default.format.printf((info) => {
    // Sanitize sensitive data
    const sanitized = sanitizeLogData(info);
    return JSON.stringify(sanitized);
}));
// Console format for development
const consoleFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({
    format: "HH:mm:ss",
}), winston_1.default.format.colorize(), winston_1.default.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length
        ? JSON.stringify(meta, null, 2)
        : "";
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
}));
// Create logger instance
const logger = winston_1.default.createLogger({
    level: config_1.config.logLevel,
    format: customFormat,
    defaultMeta: {
        service: "planvita-api",
        version: config_1.config.server.apiVersion,
    },
    transports: [
        // File transport for all logs
        new winston_1.default.transports.File({
            filename: config_1.config.logFile,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true,
        }),
        // Separate file for errors
        new winston_1.default.transports.File({
            filename: path_1.default.join(logsDir, "error.log"),
            level: "error",
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true,
        }),
    ],
});
exports.winstonLogger = logger;
// Add console transport for development
if (config_1.config.server.nodeEnv !== "production") {
    logger.add(new winston_1.default.transports.Console({
        format: consoleFormat,
    }));
}
// Sanitize sensitive data from logs
function sanitizeLogData(data) {
    const sensitiveFields = [
        "password",
        "token",
        "secret",
        "key",
        "authorization",
        "cardNumber",
        "cardCvv",
        "cardToken",
        "pixKey",
    ];
    if (typeof data !== "object" || data === null) {
        return data;
    }
    const sanitized = { ...data };
    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = "[REDACTED]";
        }
    }
    // Recursively sanitize nested objects
    for (const key in sanitized) {
        if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
            sanitized[key] = sanitizeLogData(sanitized[key]);
        }
    }
    return sanitized;
}
// Enhanced logger with context support
class Logger {
    constructor(context) {
        this.context = {};
        if (context) {
            this.context = context;
        }
    }
    formatMessage(message, meta) {
        return {
            message,
            ...this.context,
            ...meta,
        };
    }
    info(message, meta) {
        logger.info(this.formatMessage(message, meta));
    }
    error(message, error, meta) {
        const errorMeta = error instanceof Error
            ? {
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                },
            }
            : { error };
        logger.error(this.formatMessage(message, { ...errorMeta, ...meta }));
    }
    warn(message, meta) {
        logger.warn(this.formatMessage(message, meta));
    }
    debug(message, meta) {
        logger.debug(this.formatMessage(message, meta));
    }
    child(context) {
        return new Logger({ ...this.context, ...context });
    }
}
exports.Logger = Logger;
// Default logger instance
exports.defaultLogger = new Logger();
exports.default = Logger;
