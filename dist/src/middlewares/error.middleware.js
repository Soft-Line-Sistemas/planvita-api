"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
exports.notFoundHandler = notFoundHandler;
exports.asyncHandler = asyncHandler;
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
const errors_2 = require("../utils/errors");
const config_1 = __importDefault(require("../config"));
const API_VERSION = config_1.default.server.apiVersionStatic;
const logger = new logger_1.Logger({ service: 'error-middleware' });
// Error handler middleware
function errorHandler(error, req, res, next) {
    const authenticatedReq = req;
    const requestId = authenticatedReq.requestId || 'unknown';
    // Log the error
    logger.error('Request error occurred', error, {
        requestId,
        method: authenticatedReq.method,
        url: authenticatedReq.url,
        userAgent: authenticatedReq.headers['user-agent'],
        ip: authenticatedReq.ip,
        apiKeyId: authenticatedReq.apiKey?.id
    });
    // Handle validation errors
    if ((0, errors_1.isValidationError)(error)) {
        return res.status(400).json((0, errors_1.createErrorResponse)('VALIDATION_ERROR', error.message, error.details, { requestId }));
    }
    // Handle authentication errors
    if ((0, errors_1.isAuthenticationError)(error)) {
        return res.status(401).json((0, errors_1.createErrorResponse)('AUTH_001', error.message, undefined, { requestId }));
    }
    // Handle database errors
    if (error instanceof errors_2.DatabaseError) {
        return res.status(500).json((0, errors_1.createErrorResponse)('DATABASE_ERROR', 'Database operation failed', process.env.NODE_ENV === 'development' ? error.details : undefined, { requestId }));
    }
    // Handle configuration errors
    if (error instanceof errors_2.ConfigurationError) {
        return res.status(500).json((0, errors_1.createErrorResponse)('CONFIGURATION_ERROR', 'Service configuration error', process.env.NODE_ENV === 'development' ? error.details : undefined, { requestId }));
    }
    // Handle Joi validation errors
    if (error.isJoi) {
        const validationErrors = error.details.map((detail) => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value
        }));
        return res.status(400).json((0, errors_1.createErrorResponse)('VALIDATION_ERROR', 'Request validation failed', { errors: validationErrors }, { requestId }));
    }
    // Handle Prisma errors
    if (error.code && error.code.startsWith('P')) {
        return handlePrismaError(error, authenticatedReq, res);
    }
    // Handle HTTP errors
    if (error.status || error.statusCode) {
        const statusCode = error.status || error.statusCode;
        return res.status(statusCode).json((0, errors_1.createErrorResponse)(`HTTP_${statusCode}`, error.message || 'HTTP error occurred', process.env.NODE_ENV === 'development' ? error.stack : undefined, { requestId }));
    }
    // Handle syntax errors (malformed JSON, etc.)
    if (error instanceof SyntaxError && 'body' in error) {
        return res.status(400).json((0, errors_1.createErrorResponse)('SYNTAX_ERROR', 'Invalid JSON in request body', undefined, { requestId }));
    }
    // Handle generic errors
    const statusCode = 500;
    const errorCode = 'INTERNAL_ERROR';
    const message = process.env.NODE_ENV === 'production'
        ? 'An internal error occurred'
        : error.message || 'Unknown error occurred';
    res.status(statusCode).json((0, errors_1.createErrorResponse)(errorCode, message, process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        name: error.name
    } : undefined, { requestId }));
}
// Handle Prisma-specific errors
function handlePrismaError(error, req, res) {
    const requestId = req.requestId || 'unknown';
    switch (error.code) {
        case 'P2002':
            // Unique constraint violation
            return res.status(409).json((0, errors_1.createErrorResponse)('DUPLICATE_ENTRY', 'A record with this data already exists', {
                fields: error.meta?.target,
                constraint: error.meta?.constraint
            }, { requestId }));
        case 'P2025':
            // Record not found
            return res.status(404).json((0, errors_1.createErrorResponse)('RECORD_NOT_FOUND', 'The requested record was not found', { cause: error.meta?.cause }, { requestId }));
        case 'P2003':
            // Foreign key constraint violation
            return res.status(400).json((0, errors_1.createErrorResponse)('FOREIGN_KEY_VIOLATION', 'Referenced record does not exist', {
                field: error.meta?.field_name,
                constraint: error.meta?.constraint
            }, { requestId }));
        case 'P2014':
            // Required relation violation
            return res.status(400).json((0, errors_1.createErrorResponse)('REQUIRED_RELATION_VIOLATION', 'Required related record is missing', { relation: error.meta?.relation_name }, { requestId }));
        case 'P1001':
            // Database unreachable
            return res.status(503).json((0, errors_1.createErrorResponse)('DATABASE_UNREACHABLE', 'Database is currently unavailable', undefined, { requestId }));
        case 'P1008':
            // Timeout
            return res.status(504).json((0, errors_1.createErrorResponse)('DATABASE_TIMEOUT', 'Database operation timed out', undefined, { requestId }));
        default:
            // Generic Prisma error
            return res.status(500).json((0, errors_1.createErrorResponse)('DATABASE_ERROR', 'Database operation failed', process.env.NODE_ENV === 'development' ? {
                code: error.code,
                message: error.message,
                meta: error.meta
            } : undefined, { requestId }));
    }
}
// 404 handler for undefined routes
function notFoundHandler(req, res, next) {
    const authenticatedReq = req;
    const requestId = authenticatedReq.requestId || 'unknown';
    logger.warn('Route not found', {
        requestId,
        method: req.method,
        url: req.url,
        ip: req.ip
    });
    res.status(404).json((0, errors_1.createErrorResponse)('ROUTE_NOT_FOUND', `Route ${req.method} ${req.url} not found`, {
        method: req.method,
        url: req.url,
        availableEndpoints: [
            `GET /health`
            // `GET /api/${API_VERSION}/`,
        ]
    }, { requestId }));
}
// Async error wrapper
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
// Global unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', reason, {
        promise: promise.toString()
    });
    // Don't exit the process in production
    if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
    }
});
// Global uncaught exception handler
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    // Exit the process for uncaught exceptions
    process.exit(1);
});
exports.default = {
    errorHandler,
    notFoundHandler,
    asyncHandler
};
