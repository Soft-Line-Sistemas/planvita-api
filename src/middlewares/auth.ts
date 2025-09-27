import { Request, Response, NextFunction } from 'express';
import { prisma } from '../models/database';
import { AuthenticatedRequest } from '../types';
import { Logger } from '../utils/logger';
import { 
  AuthenticationError, 
  InvalidApiKeyError 
} from '../utils/errors';
import { 
  createErrorResponse,
  verifyApiKey,
  generateRequestId 
} from '../utils/helpers';

const logger = new Logger({ service: 'auth-middleware' });

export async function authenticateApiKey(
  req: Request & Partial<AuthenticatedRequest>,
  res: Response, 
  next: NextFunction
): Promise<Response | void> {
  try {
    // Generate request ID for tracing
  const requestId = req.requestId || generateRequestId();
  req.requestId = requestId;

    // Extract API key from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Missing or invalid authorization header', { requestId });
      return res.status(401).json(
        createErrorResponse('AUTH_001', 'Missing or invalid authorization header', undefined, { requestId })
      );
    }

    const apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (!apiKey) {
      logger.warn('Empty API key provided', { requestId });
      return res.status(401).json(
        createErrorResponse('AUTH_001', 'Empty API key provided', undefined, { requestId })
      );
    }

    // Find API key in database
    const apiKeyRecord = await prisma.apiKey.findFirst({
      where: {
        isActive: true
      }
    });

    if (!apiKeyRecord) {
      logger.warn('No active API keys found', { requestId });
      return res.status(401).json(
        createErrorResponse('AUTH_001', 'Invalid API key', undefined, { requestId })
      );
    }

    // Verify API key
    const isValid = await verifyApiKey(apiKey, apiKeyRecord.keyHash);
    if (!isValid) {
      logger.warn('Invalid API key provided', { requestId, keyId: apiKeyRecord.id });
      return res.status(401).json(
        createErrorResponse('AUTH_001', 'Invalid API key', undefined, { requestId })
      );
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsedAt: new Date() }
    });

    // Add API key info to request
    (req as AuthenticatedRequest).apiKey = {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      permissions: JSON.parse(apiKeyRecord.permissions) as Record<string, any>
    };

    logger.info('API key authenticated successfully', {
      requestId,
      keyId: apiKeyRecord.id,
      keyName: apiKeyRecord.name
    });

    next();
  } catch (error) {
    logger.error('Authentication error', error);
    res.status(500).json(
      createErrorResponse('AUTH_001', 'Authentication error', error)
    );
  }
}

export function optionalAuth(
  req: Request & Partial<AuthenticatedRequest>,
  res: Response, 
  next: NextFunction
): Response | void {
  // Generate request ID even for unauthenticated requests
  const requestId = req.requestId || generateRequestId();
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

export function requirePermission(permission: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): Response | void => {
    const requestId = req.requestId;
    
    if (!req.apiKey) {
      logger.warn('Permission check failed - no API key', { requestId, permission });
      return res.status(401).json(
        createErrorResponse('AUTH_001', 'Authentication required', undefined, { requestId })
      );
    }

    const permissions = req.apiKey.permissions;
    if (!permissions[permission] && !permissions['*']) {
      logger.warn('Permission check failed - insufficient permissions', {
        requestId,
        keyId: req.apiKey.id,
        permission,
        availablePermissions: Object.keys(permissions)
      });
      
      return res.status(403).json(
        createErrorResponse('AUTH_002', 'Insufficient permissions', { 
          required: permission,
          available: Object.keys(permissions)
        }, { requestId })
      );
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
export function addRequestId(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authenticatedReq = req as unknown as AuthenticatedRequest;
  if (!authenticatedReq.requestId) {
    authenticatedReq.requestId = generateRequestId();
  }
  next();
}

// Middleware to log requests
export function logRequest(
  req: Request, 
  res: Response, 
  next: NextFunction
): Response | void {
  const authenticatedReq = req as unknown as AuthenticatedRequest;
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
