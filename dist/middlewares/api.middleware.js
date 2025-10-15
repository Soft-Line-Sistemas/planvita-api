"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateApiKey = authenticateApiKey;
exports.optionalAuth = optionalAuth;
exports.requirePermission = requirePermission;
exports.addRequestId = addRequestId;
exports.logRequest = logRequest;
const prisma_1 = require("../utils/prisma");
const logger_1 = require("../utils/logger");
const helpers_1 = require("../utils/helpers");
const logger = new logger_1.Logger({ service: 'auth-middleware' });
async function authenticateApiKey(req, res, next) {
    try {
        // Generate request ID for tracing
        const requestId = req.requestId || (0, helpers_1.generateRequestId)();
        req.requestId = requestId;
        // Extract API key from header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            logger.warn('Missing or invalid authorization header', { requestId });
            return res.status(401).json((0, helpers_1.createErrorResponse)('AUTH_001', 'Missing or invalid authorization header', undefined, { requestId }));
        }
        const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
        if (!apiKey) {
            logger.warn('Empty API key provided', { requestId });
            return res.status(401).json((0, helpers_1.createErrorResponse)('AUTH_001', 'Empty API key provided', undefined, { requestId }));
        }
        // Find API key in database
        const apiKeyRecord = await prisma_1.prisma.apiKey.findFirst({
            where: {
                isActive: true
            }
        });
        if (!apiKeyRecord) {
            logger.warn('No active API keys found', { requestId });
            return res.status(401).json((0, helpers_1.createErrorResponse)('AUTH_001', 'Invalid API key', undefined, { requestId }));
        }
        // Verify API key
        const isValid = await (0, helpers_1.verifyApiKey)(apiKey, apiKeyRecord.keyHash);
        if (!isValid) {
            logger.warn('Invalid API key provided', { requestId, keyId: apiKeyRecord.id });
            return res.status(401).json((0, helpers_1.createErrorResponse)('AUTH_001', 'Invalid API key', undefined, { requestId }));
        }
        // Update last used timestamp
        await prisma_1.prisma.apiKey.update({
            where: { id: apiKeyRecord.id },
            data: { lastUsedAt: new Date() }
        });
        // Add API key info to request
        req.apiKey = {
            id: apiKeyRecord.id,
            name: apiKeyRecord.name,
            permissions: JSON.parse(apiKeyRecord.permissions)
        };
        logger.info('API key authenticated successfully', {
            requestId,
            keyId: apiKeyRecord.id,
            keyName: apiKeyRecord.name
        });
        next();
    }
    catch (error) {
        logger.error('Authentication error', error);
        res.status(500).json((0, helpers_1.createErrorResponse)('AUTH_001', 'Authentication error', error));
    }
}
function optionalAuth(req, res, next) {
    // Generate request ID even for unauthenticated requests
    const requestId = req.requestId || (0, helpers_1.generateRequestId)();
    req.requestId = requestId;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // No authentication provided, continue without auth
        next();
        return;
    }
    // If auth header is present, validate it
    authenticateApiKey(req, res, next);
}
function requirePermission(permission) {
    return (req, res, next) => {
        const requestId = req.requestId;
        if (!req.apiKey) {
            logger.warn('Permission check failed - no API key', { requestId, permission });
            return res.status(401).json((0, helpers_1.createErrorResponse)('AUTH_001', 'Authentication required', undefined, { requestId }));
        }
        const permissions = req.apiKey.permissions;
        if (!permissions[permission] && !permissions['*']) {
            logger.warn('Permission check failed - insufficient permissions', {
                requestId,
                keyId: req.apiKey.id,
                permission,
                availablePermissions: Object.keys(permissions)
            });
            return res.status(403).json((0, helpers_1.createErrorResponse)('AUTH_002', 'Insufficient permissions', {
                required: permission,
                available: Object.keys(permissions)
            }, { requestId }));
        }
        logger.debug('Permission check passed', {
            requestId,
            keyId: req.apiKey.id,
            permission
        });
        next();
    };
}
// Middleware to add request ID to all requests
function addRequestId(req, res, next) {
    const authenticatedReq = req;
    if (!authenticatedReq.requestId) {
        authenticatedReq.requestId = (0, helpers_1.generateRequestId)();
    }
    next();
}
// Middleware to log requests
function logRequest(req, res, next) {
    const authenticatedReq = req;
    const startTime = Date.now();
    logger.info('Request received', {
        requestId: authenticatedReq.requestId,
        method: authenticatedReq.method,
        url: authenticatedReq.url,
        userAgent: authenticatedReq.headers['user-agent'],
        ip: authenticatedReq.ip,
        apiKeyId: authenticatedReq.apiKey?.id
    });
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        logger.info('Request completed', {
            requestId: authenticatedReq.requestId,
            method: authenticatedReq.method,
            url: authenticatedReq.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`
        });
    });
    next();
}
