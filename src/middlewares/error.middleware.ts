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
import config from '../config';

const API_VERSION = config.server.apiVersionStatic;

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
      createErrorResponse('ERRO_VALIDACAO', error.message || 'Falha na validação dos dados', error.details, { requestId })
    );
  }

  // Handle authentication errors
  if (isAuthenticationError(error)) {
    return res.status(401).json(
      createErrorResponse('AUTH_001', error.message || 'Não autenticado', undefined, { requestId })
    );
  }

  // Handle database errors
  if (error instanceof DatabaseError) {
    return res.status(500).json(
      createErrorResponse('ERRO_BANCO_DADOS', 'Falha na operação com o banco de dados', process.env.NODE_ENV === 'development' ? error.details : undefined, { requestId })
    );
  }

  // Handle configuration errors
  if (error instanceof ConfigurationError) {
    return res.status(500).json(
      createErrorResponse('ERRO_CONFIGURACAO', 'Erro de configuração do serviço', process.env.NODE_ENV === 'development' ? error.details : undefined, { requestId })
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
      createErrorResponse('ERRO_VALIDACAO', 'Falha na validação da requisição', { errors: validationErrors }, { requestId })
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
      createErrorResponse(`HTTP_${statusCode}`, error.message || 'Erro HTTP', process.env.NODE_ENV === 'development' ? error.stack : undefined, { requestId })
    );
  }

  // Handle syntax errors (malformed JSON, etc.)
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json(
      createErrorResponse('ERRO_SINTAXE', 'JSON inválido no corpo da requisição', undefined, { requestId })
    );
  }

  // Handle generic errors
  const statusCode = 500;
  const errorCode = 'ERRO_INTERNO';
  const message = process.env.NODE_ENV === 'production' ? 'Erro interno no servidor' : error.message || 'Erro desconhecido'

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
      createErrorResponse('REGISTRO_DUPLICADO', 'Já existe um registro com estes dados', { fields: error.meta?.target, constraint: error.meta?.constraint }, { requestId })
      );

    case 'P2025':
      // Record not found
      return res.status(404).json(
      createErrorResponse('REGISTRO_NAO_ENCONTRADO', 'Registro não encontrado', { cause: error.meta?.cause }, { requestId })
      );

    case 'P2003':
      // Foreign key constraint violation
      return res.status(400).json(
      createErrorResponse('VIOLACAO_CHAVE_ESTRANGEIRA', 'Registro referenciado não existe', { field: error.meta?.field_name, constraint: error.meta?.constraint }, { requestId })
      );

    case 'P2014':
      // Required relation violation
      return res.status(400).json(
      createErrorResponse('RELACAO_OBRIGATORIA_AUSENTE', 'Registro relacionado obrigatório está ausente', { relation: error.meta?.relation_name }, { requestId })
      );

    case 'P1001':
      // Database unreachable
      return res.status(503).json(
      createErrorResponse('BANCO_INDISPONIVEL', 'Banco de dados indisponível', undefined, { requestId })
      );

    case 'P1008':
      // Timeout
      return res.status(504).json(
      createErrorResponse('TEMPO_ESGOTADO', 'Tempo excedido na operação de banco de dados', undefined, { requestId })
      );

    default:
      // Generic Prisma error
      return res.status(500).json(
      createErrorResponse('ERRO_BANCO_DADOS', 'Falha na operação com o banco de dados', process.env.NODE_ENV === 'development' ? { code: error.code, message: error.message, meta: error.meta } : undefined, { requestId })
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
  
  logger.warn('Rota não encontrada', {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip
  });

  res.status(404).json(
    createErrorResponse('ROTA_NAO_ENCONTRADA', `Rota ${req.method} ${req.url} não encontrada`, { method: req.method, url: req.url, availableEndpoints: [`GET /health`] }, { requestId })
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

