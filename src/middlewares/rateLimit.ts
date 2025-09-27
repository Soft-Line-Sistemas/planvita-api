import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request, Response } from 'express';
import { prisma } from '../models/database';
import { AuthenticatedRequest, RateLimitInfo } from '../types';
import { Logger } from '../utils/logger';
import { config } from '../config';
import { createErrorResponse } from '../utils/helpers';

const logger = new Logger({ service: 'rate-limit-middleware' });

// Default rate limit configuration
const DEFAULT_WINDOW_MS = config.rateLimitWindowMs; // 15 minutes
const DEFAULT_MAX_REQUESTS = config.rateLimitMaxRequests; // 100 requests

// Rate limit store using memory (for production, consider Redis)
type RateLimitEntry = {
  count: number;
  resetTime: number;
  windowStart: number;
};

const store: Record<string, RateLimitEntry> = {};

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
async function customRateLimitHandler(
  req: Request | AuthenticatedRequest,
  res: Response
): Promise<void> {
  const requestId =
    (req as AuthenticatedRequest).requestId || 'unknown';
  
  logger.warn('Rate limit exceeded', {
    requestId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    url: req.url,
    method: req.method
  });

  res.status(429).json(
    createErrorResponse(
      'RATE_LIMIT_EXCEEDED',
      'Too many requests, please try again later',
      {
        retryAfter: res.get('Retry-After'),
        limit: res.get('X-RateLimit-Limit'),
        remaining: res.get('X-RateLimit-Remaining'),
        reset: res.get('X-RateLimit-Reset')
      },
      { requestId }
    )
  );
}

// Key generator function
function generateKey(req: AuthenticatedRequest): string {
  if (req.apiKey) {
    return `api_key:${req.apiKey.id}`;
  }
  const ip = req.ip || '0.0.0.0';
  return ipKeyGenerator(ip);
}

// Custom rate limit implementation
async function customRateLimit(
  windowMs: number = DEFAULT_WINDOW_MS,
  maxRequests: number = DEFAULT_MAX_REQUESTS
) {
  return async (req: AuthenticatedRequest, res: Response, next: Function): Promise<void> => {
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
          const apiKeyRecord = await prisma.apiKey.findUnique({
            where: { id: req.apiKey.id }
          });

          if (apiKeyRecord) {
            userMaxRequests = apiKeyRecord.rateLimit;
            userWindowMs = apiKeyRecord.windowMs;
          }
        } catch (error) {
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
    } catch (error) {
      logger.error('Rate limit middleware error', error, {
        requestId: req.requestId
      });
      next(); // Continue on error to avoid blocking requests
    }
  };
}

// Express rate limit configurations
export const generalRateLimit = rateLimit({
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
  keyGenerator: (req: Request) => generateKey(req as unknown as AuthenticatedRequest),
  validate: {
    keyGeneratorIpFallback: false
  }
});

// Stricter rate limit for payment creation
export const paymentCreationRateLimit = rateLimit({
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
  keyGenerator: (req: Request) => generateKey(req as unknown as AuthenticatedRequest)
});

// Webhook rate limit (more permissive)
export const webhookRateLimit = rateLimit({
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
  keyGenerator: (req: Request) => `webhook:${generateKey(req as unknown as AuthenticatedRequest)}`
});

// Health check rate limit (very permissive)
export const healthCheckRateLimit = rateLimit({
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
  keyGenerator: (req: Request) => `health:${generateKey(req as unknown as AuthenticatedRequest)}`
});

// Custom rate limit middleware
export const customRateLimitMiddleware = customRateLimit();

// Rate limit info middleware
export function addRateLimitInfo(req: AuthenticatedRequest, res: Response, next: Function): void {
  const key = generateKey(req);
  const entry = store[key];

  if (entry) {
    const rateLimitInfo: RateLimitInfo = {
      limit: parseInt(res.get('X-RateLimit-Limit') || '0'),
      remaining: parseInt(res.get('X-RateLimit-Remaining') || '0'),
      reset: new Date(parseInt(res.get('X-RateLimit-Reset') || '0') * 1000)
    };

    // Add to request for use in handlers
    (req as any).rateLimitInfo = rateLimitInfo;
  }

  next();
}

export default {
  general: generalRateLimit,
  paymentCreation: paymentCreationRateLimit,
  webhook: webhookRateLimit,
  healthCheck: healthCheckRateLimit,
  custom: customRateLimitMiddleware,
  addInfo: addRateLimitInfo
};

