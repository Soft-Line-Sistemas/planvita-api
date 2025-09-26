export interface AppError {
  code: string;
  statusCode: number;
  message: string;
  details?: any;
}

export class BaseError extends Error implements AppError {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: any;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    details?: any,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// Validation Errors (400)
export class ValidationError extends BaseError {
  constructor(message: string, details?: any) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

// Authentication Errors (401)
export class AuthenticationError extends BaseError {
  constructor(message: string = "Invalid authentication credentials") {
    super(message, "AUTH_001", 401);
  }
}

// Not Found Errors (404)
export class NotFoundError extends BaseError {
  constructor(resource: string, identifier?: string) {
    const idText = identifier ? ` with ID ${identifier}` : "";
    super(`${resource}${idText} not found`, "NOT_FOUND", 404);
  }
}

// Rate Limiting Errors (429)
export class RateLimitExceededError extends BaseError {
  constructor(message: string = "Rate limit exceeded") {
    super(message, "RATE_LIMIT_EXCEEDED", 429);
  }
}

// Internal Server Errors (500)
export class DatabaseError extends BaseError {
  constructor(message: string, details?: any) {
    super(message, "DATABASE_ERROR", 500, details);
  }
}

export class ConfigurationError extends BaseError {
  constructor(message: string, details?: any) {
    super(message, "CONFIGURATION_ERROR", 500, details);
  }
}

// Error type guards
export function isAppError(error: any): error is AppError {
  return (
    error instanceof BaseError ||
    (error &&
      typeof error.code === "string" &&
      typeof error.statusCode === "number")
  );
}

export function isValidationError(error: any): error is ValidationError {
  return (
    error instanceof ValidationError ||
    (isAppError(error) && error.statusCode === 400)
  );
}

export function isAuthenticationError(
  error: any,
): error is AuthenticationError {
  return (
    error instanceof AuthenticationError ||
    (isAppError(error) && error.statusCode === 401)
  );
}

export function isNotFoundError(error: any): error is NotFoundError {
  return (
    error instanceof NotFoundError ||
    (isAppError(error) && error.statusCode === 404)
  );
}

// Error codes mapping
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTH_001: "AUTH_001",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  DATABASE_ERROR: "DATABASE_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
