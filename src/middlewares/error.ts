import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { Logger } from '../utils/logger';
import { 
  isValidationError,
  isAuthenticationError,
  createErrorResponse 
} from '../utils/errors';
import { 
  ValidationError,
  AuthenticationError,
  DatabaseError,
  ConfigurationError
} from '../utils/errors';

const logger = new Logger({ service: 'error-middleware' });

// Error handler middleware
export function errorHandler(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
): Response | void {
  const authenticatedReq = req as unknown as  AuthenticatedRequest;
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
  if (isValidationError(error)) {
    return res.status(400).json(
      createErrorResponse(
        'VALIDATION_ERROR',
        error.message,
        error.details,
        { requestId }
      )
    );
  }

  // Handle authentication errors
  if (isAuthenticationError(error)) {
    return res.status(401).json(
      createErrorResponse(
        'AUTH_001',
        error.message,
        undefined,
        { requestId }
      )
    );
  }

  // Handle database errors
  if (error instanceof DatabaseError) {
    return res.status(500).json(
      createErrorResponse(
        'DATABASE_ERROR',
        'Database operation failed',
        process.env.NODE_ENV === 'development' ? error.details : undefined,
        { requestId }
      )
    );
  }

  // Handle configuration errors
  if (error instanceof ConfigurationError) {
    return res.status(500).json(
      createErrorResponse(
        'CONFIGURATION_ERROR',
        'Service configuration error',
        process.env.NODE_ENV === 'development' ? error.details : undefined,
        { requestId }
      )
    );
  }

  // Handle Joi validation errors
  if (error.isJoi) {
    const validationErrors = error.details.map((detail: any) => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value
    }));

    return res.status(400).json(
      createErrorResponse(
        'VALIDATION_ERROR',
        'Request validation failed',
        { errors: validationErrors },
        { requestId }
      )
    );
  }

  // Handle Prisma errors
  if (error.code && error.code.startsWith('P')) {
    return handlePrismaError(error, authenticatedReq, res);
  }

  // Handle HTTP errors
  if (error.status || error.statusCode) {
    const statusCode = error.status || error.statusCode;
    return res.status(statusCode).json(
      createErrorResponse(
        `HTTP_${statusCode}`,
        error.message || 'HTTP error occurred',
        process.env.NODE_ENV === 'development' ? error.stack : undefined,
        { requestId }
      )
    );
  }

  // Handle syntax errors (malformed JSON, etc.)
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json(
      createErrorResponse(
        'SYNTAX_ERROR',
        'Invalid JSON in request body',
        undefined,
        { requestId }
      )
    );
  }

  // Handle generic errors
  const statusCode = 500;
  const errorCode = 'INTERNAL_ERROR';
  const message = process.env.NODE_ENV === 'production' 
    ? 'An internal error occurred' 
    : error.message || 'Unknown error occurred';

  res.status(statusCode).json(
    createErrorResponse(
      errorCode,
      message,
      process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        name: error.name
      } : undefined,
      { requestId }
    )
  );
}

// Handle Prisma-specific errors
function handlePrismaError(error: any, req: AuthenticatedRequest, res: Response): Response | void {
  const requestId = req.requestId || 'unknown';

  switch (error.code) {
    case 'P2002':
      // Unique constraint violation
      return res.status(409).json(
        createErrorResponse(
          'DUPLICATE_ENTRY',
          'A record with this data already exists',
          { 
            fields: error.meta?.target,
            constraint: error.meta?.constraint
          },
          { requestId }
        )
      );

    case 'P2025':
      // Record not found
      return res.status(404).json(
        createErrorResponse(
          'RECORD_NOT_FOUND',
          'The requested record was not found',
          { cause: error.meta?.cause },
          { requestId }
        )
      );

    case 'P2003':
      // Foreign key constraint violation
      return res.status(400).json(
        createErrorResponse(
          'FOREIGN_KEY_VIOLATION',
          'Referenced record does not exist',
          { 
            field: error.meta?.field_name,
            constraint: error.meta?.constraint
          },
          { requestId }
        )
      );

    case 'P2014':
      // Required relation violation
      return res.status(400).json(
        createErrorResponse(
          'REQUIRED_RELATION_VIOLATION',
          'Required related record is missing',
          { relation: error.meta?.relation_name },
          { requestId }
        )
      );

    case 'P1001':
      // Database unreachable
      return res.status(503).json(
        createErrorResponse(
          'DATABASE_UNREACHABLE',
          'Database is currently unavailable',
          undefined,
          { requestId }
        )
      );

    case 'P1008':
      // Timeout
      return res.status(504).json(
        createErrorResponse(
          'DATABASE_TIMEOUT',
          'Database operation timed out',
          undefined,
          { requestId }
        )
      );

    default:
      // Generic Prisma error
      return res.status(500).json(
        createErrorResponse(
          'DATABASE_ERROR',
          'Database operation failed',
          process.env.NODE_ENV === 'development' ? {
            code: error.code,
            message: error.message,
            meta: error.meta
          } : undefined,
          { requestId }
        )
      );
  }
}

// 404 handler for undefined routes
export function notFoundHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Response | void {
 const authenticatedReq = req as unknown as  AuthenticatedRequest;
  const requestId = authenticatedReq.requestId || 'unknown';
  
  logger.warn('Route not found', {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip
  });

  res.status(404).json(
    createErrorResponse(
      'ROUTE_NOT_FOUND',
      `Route ${req.method} ${req.url} not found`,
      {
        method: req.method,
        url: req.url,
        availableEndpoints: [
          'GET /health'
        ]
      },
      { requestId }
    )
  );
}

// Async error wrapper
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Global unhandled rejection handler
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled promise rejection', reason, {
    promise: promise.toString()
  });
  
  // Don't exit the process in production
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// Global uncaught exception handler
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', error);
  
  // Exit the process for uncaught exceptions
  process.exit(1);
});

export default {
  errorHandler,
  notFoundHandler,
  asyncHandler
};

