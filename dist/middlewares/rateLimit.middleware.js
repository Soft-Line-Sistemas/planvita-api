"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.customRateLimitMiddleware = exports.healthCheckRateLimit = exports.webhookRateLimit = exports.paymentCreationRateLimit = exports.generalRateLimit = void 0;
exports.addRateLimitInfo = addRateLimitInfo;
const express_rate_limit_1 = __importStar(require("express-rate-limit"));
const prisma_1 = require("../utils/prisma");
const logger_1 = require("../utils/logger");
const config_1 = require("../config");
const helpers_1 = require("../utils/helpers");
const logger = new logger_1.Logger({ service: 'rate-limit-middleware' });
// Default rate limit configuration
const DEFAULT_WINDOW_MS = config_1.config.rateLimitWindowMs; // 15 minutes
const DEFAULT_MAX_REQUESTS = config_1.config.rateLimitMaxRequests; // 100 requests
const store = {};
// Cleanup old entries periodically
setInterval(() => {
    const now = Date.now();
    Object.keys(store).forEach(key => {
        const entry = store[key];
        if (entry && entry.resetTime < now) {
            delete store[key];
        }
    });
}, 60000);
// Custom rate limit handler
async function customRateLimitHandler(req, res) {
    const requestId = req.requestId || 'unknown';
    logger.warn('Rate limit exceeded', {
        requestId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        url: req.url,
        method: req.method
    });
    res.status(429).json((0, helpers_1.createErrorResponse)('RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later', {
        retryAfter: res.get('Retry-After'),
        limit: res.get('X-RateLimit-Limit'),
        remaining: res.get('X-RateLimit-Remaining'),
        reset: res.get('X-RateLimit-Reset')
    }, { requestId }));
}
// Key generator function
function generateKey(req) {
    if (req.apiKey) {
        return `api_key:${req.apiKey.id}`;
    }
    const ip = req.ip || '0.0.0.0';
    return (0, express_rate_limit_1.ipKeyGenerator)(ip);
}
// Custom rate limit implementation
async function customRateLimit(windowMs = DEFAULT_WINDOW_MS, maxRequests = DEFAULT_MAX_REQUESTS) {
    return async (req, res, next) => {
        try {
            const key = generateKey(req);
            const now = Date.now();
            const windowStart = now - windowMs;
            // Get or create rate limit entry
            let entry = store[key];
            if (!entry || entry.windowStart < windowStart) {
                entry = {
                    count: 0,
                    resetTime: now + windowMs,
                    windowStart: now
                };
                store[key] = entry;
            }
            // Check if authenticated user has custom limits
            let userMaxRequests = maxRequests;
            let userWindowMs = windowMs;
            if (req.apiKey) {
                try {
                    const apiKeyRecord = await prisma_1.prisma.apiKey.findUnique({
                        where: { id: req.apiKey.id }
                    });
                    if (apiKeyRecord) {
                        userMaxRequests = apiKeyRecord.rateLimit;
                        userWindowMs = apiKeyRecord.windowMs;
                    }
                }
                catch (error) {
                    logger.warn('Failed to get custom rate limits', {
                        error,
                        requestId: req.requestId,
                        apiKeyId: req.apiKey?.id
                    });
                }
            }
            // Increment counter
            entry.count++;
            // Set rate limit headers
            res.set({
                'X-RateLimit-Limit': userMaxRequests.toString(),
                'X-RateLimit-Remaining': Math.max(0, userMaxRequests - entry.count).toString(),
                'X-RateLimit-Reset': Math.ceil(entry.resetTime / 1000).toString(),
                'X-RateLimit-Window': Math.ceil(userWindowMs / 1000).toString()
            });
            // Check if limit exceeded
            if (entry.count > userMaxRequests) {
                res.set('Retry-After', Math.ceil((entry.resetTime - now) / 1000).toString());
                await customRateLimitHandler(req, res);
                return;
            }
            // Log rate limit info
            logger.debug('Rate limit check passed', {
                requestId: req.requestId,
                key,
                count: entry.count,
                limit: userMaxRequests,
                remaining: userMaxRequests - entry.count
            });
            next();
        }
        catch (error) {
            logger.error('Rate limit middleware error', error, {
                requestId: req.requestId
            });
            next(); // Continue on error to avoid blocking requests
        }
    };
}
// Express rate limit configurations
exports.generalRateLimit = (0, express_rate_limit_1.default)({
    windowMs: DEFAULT_WINDOW_MS,
    max: DEFAULT_MAX_REQUESTS,
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests, please try again later'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: customRateLimitHandler,
    keyGenerator: (req) => generateKey(req),
    validate: {
        keyGeneratorIpFallback: false
    }
});
// Stricter rate limit for payment creation
exports.paymentCreationRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 10, // 10 payment creations per minute
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many payment creation requests, please try again later'
        }
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: customRateLimitHandler,
    keyGenerator: (req) => generateKey(req)
});
// Webhook rate limit (more permissive)
exports.webhookRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 100, // 100 webhooks per minute
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many webhook requests'
        }
    },
    standardHeaders: false,
    legacyHeaders: false,
    handler: customRateLimitHandler,
    keyGenerator: (req) => `webhook:${generateKey(req)}`
});
// Health check rate limit (very permissive)
exports.healthCheckRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 60000, // 1 minute
    max: 60, // 60 health checks per minute
    message: {
        success: false,
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many health check requests'
        }
    },
    standardHeaders: false,
    legacyHeaders: false,
    handler: customRateLimitHandler,
    keyGenerator: (req) => `health:${generateKey(req)}`
});
// Custom rate limit middleware
exports.customRateLimitMiddleware = customRateLimit();
// Rate limit info middleware
function addRateLimitInfo(req, res, next) {
    const key = generateKey(req);
    const entry = store[key];
    if (entry) {
        const rateLimitInfo = {
            limit: parseInt(res.get('X-RateLimit-Limit') || '0'),
            remaining: parseInt(res.get('X-RateLimit-Remaining') || '0'),
            reset: new Date(parseInt(res.get('X-RateLimit-Reset') || '0') * 1000)
        };
        // Add to request for use in handlers
        req.rateLimitInfo = rateLimitInfo;
    }
    next();
}
exports.default = {
    general: exports.generalRateLimit,
    paymentCreation: exports.paymentCreationRateLimit,
    webhook: exports.webhookRateLimit,
    healthCheck: exports.healthCheckRateLimit,
    custom: exports.customRateLimitMiddleware,
    addInfo: addRateLimitInfo
};
