"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.validateConfig = validateConfig;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    database: {
        url: getEnvVarOptional('DATABASE_URL'),
    },
    server: {
        apiVersion: getEnvVar('API_VERSION', '1.0.0'),
        apiVersionStatic: getEnvVar('API_VERSION_STATIC', 'v1'),
        port: getEnvVarAsNumber('PORT', 61348),
        nodeEnv: getEnvVar('NODE_ENV', 'development'),
        allowedOrigins: getEnvVarAsArray('ALLOWED_ORIGINS'),
    },
    jwt: {
        secret: getEnvVar('JWT_SECRET', '5b75be29b1aafd1b19d85c99f1ecf824faccd406083800ac4481f743c037860a'),
        expiresIn: getEnvVar('JWT_EXPIRES_IN', '1d'),
    },
    rateLimitWindowMs: getEnvVarAsNumber('RATE_LIMIT_WINDOW_MS', 900000), // 15 minutes
    rateLimitMaxRequests: getEnvVarAsNumber('RATE_LIMIT_MAX_REQUESTS', 100),
    logLevel: getEnvVar('LOG_LEVEL', 'info'),
    logFile: getEnvVar('LOG_FILE', 'logs/planvita-api.log'),
    encryptionKey: getEnvVar('ENCRYPTION_KEY'),
};
function getEnvVar(name, defaultValue) {
    const value = process.env[name];
    if (!value && !defaultValue) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return value || defaultValue;
}
function getEnvVarOptional(name, defaultValue) {
    return process.env[name] || defaultValue || '';
}
function getEnvVarAsNumber(name, defaultValue) {
    const value = process.env[name];
    if (!value && defaultValue === undefined) {
        throw new Error(`Environment variable ${name} is required`);
    }
    return value ? parseInt(value, 10) : defaultValue;
}
function getEnvVarAsArray(name, separator = ',') {
    return getEnvVar(name)
        .split(separator)
        .map((v) => v.trim())
        .filter(Boolean);
}
function validateConfig() {
    const errors = [];
    // if (!config.database.url) {
    //   errors.push('DATABASE_URL is required');
    // }
    if (!exports.config.jwt.secret) {
        errors.push('JWT_SECRET is required');
    }
    if (!exports.config.encryptionKey || exports.config.encryptionKey.length < 32) {
        errors.push('ENCRYPTION_KEY is required and must be at least 32 characters long');
    }
    if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
}
exports.default = exports.config;
