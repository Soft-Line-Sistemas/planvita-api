"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_CODES = exports.InvalidApiKeyError = exports.ConfigurationError = exports.DatabaseError = exports.RateLimitExceededError = exports.NotFoundError = exports.AuthenticationError = exports.ValidationError = exports.BaseError = void 0;
exports.createErrorResponse = createErrorResponse;
exports.isAppError = isAppError;
exports.isValidationError = isValidationError;
exports.isAuthenticationError = isAuthenticationError;
exports.isNotFoundError = isNotFoundError;
class BaseError extends Error {
    constructor(message, code, statusCode = 500, details) {
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
exports.BaseError = BaseError;
function createErrorResponse(code, message, details, meta) {
    return {
        success: false,
        error: {
            code,
            message,
            ...(details && { details }),
            ...(meta && { meta })
        }
    };
}
// Validation Errors (400)
class ValidationError extends BaseError {
    constructor(message, details) {
        super(message, "VALIDATION_ERROR", 400, details);
    }
}
exports.ValidationError = ValidationError;
// Authentication Errors (401)
class AuthenticationError extends BaseError {
    constructor(message = "Invalid authentication credentials") {
        super(message, "AUTH_001", 401);
    }
}
exports.AuthenticationError = AuthenticationError;
// Not Found Errors (404)
class NotFoundError extends BaseError {
    constructor(resource, identifier) {
        const idText = identifier ? ` with ID ${identifier}` : "";
        super(`${resource}${idText} not found`, "NOT_FOUND", 404);
    }
}
exports.NotFoundError = NotFoundError;
// Rate Limiting Errors (429)
class RateLimitExceededError extends BaseError {
    constructor(message = "Rate limit exceeded") {
        super(message, "RATE_LIMIT_EXCEEDED", 429);
    }
}
exports.RateLimitExceededError = RateLimitExceededError;
// Internal Server Errors (500)
class DatabaseError extends BaseError {
    constructor(message, details) {
        super(message, "DATABASE_ERROR", 500, details);
    }
}
exports.DatabaseError = DatabaseError;
class ConfigurationError extends BaseError {
    constructor(message, details) {
        super(message, "CONFIGURATION_ERROR", 500, details);
    }
}
exports.ConfigurationError = ConfigurationError;
// Error type guards
function isAppError(error) {
    return (error instanceof BaseError ||
        (error &&
            typeof error.code === "string" &&
            typeof error.statusCode === "number"));
}
function isValidationError(error) {
    return (error instanceof ValidationError ||
        (isAppError(error) && error.statusCode === 400));
}
function isAuthenticationError(error) {
    return (error instanceof AuthenticationError ||
        (isAppError(error) && error.statusCode === 401));
}
function isNotFoundError(error) {
    return (error instanceof NotFoundError ||
        (isAppError(error) && error.statusCode === 404));
}
class InvalidApiKeyError extends BaseError {
    constructor(message = 'Invalid API key') {
        super(message, 'AUTH_001', 401);
    }
}
exports.InvalidApiKeyError = InvalidApiKeyError;
// Error codes mapping
exports.ERROR_CODES = {
    VALIDATION_ERROR: "VALIDATION_ERROR",
    AUTH_001: "AUTH_001",
    NOT_FOUND: "NOT_FOUND",
    RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
    DATABASE_ERROR: "DATABASE_ERROR",
    CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
};
