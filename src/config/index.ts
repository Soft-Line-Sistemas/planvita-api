import dotenv from 'dotenv';
import { AppConfig } from '../types';

dotenv.config();

export const config: AppConfig = {
  database: {
    url: getEnvVar('DATABASE_URL'),
  },

  server: {
    apiVersion: getEnvVar('API_VERSION', 'v1'),
    port: getEnvVarAsNumber('PORT', 3000),
    nodeEnv: getEnvVar('NODE_ENV', 'development'),
    allowedOrigins: getEnvVarAsArray('ALLOWED_ORIGINS'),
  },

  jwt: {
    secret: getEnvVar('JWT_SECRET'),
    expiresIn: getEnvVar('JWT_EXPIRES_IN', '24h'),
  },

  rateLimitWindowMs: getEnvVarAsNumber('RATE_LIMIT_WINDOW_MS', 900000), // 15 minutes
  rateLimitMaxRequests: getEnvVarAsNumber('RATE_LIMIT_MAX_REQUESTS', 100),
  logLevel: getEnvVar('LOG_LEVEL', 'info'),
  logFile: getEnvVar('LOG_FILE', 'logs/vitalsoft-api.log'),

  encryptionKey: getEnvVar('ENCRYPTION_KEY'),
};

function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value || defaultValue!;
}

function getEnvVarOptional(name: string, defaultValue?: string): string {
  return process.env[name] || defaultValue || '';
}

function getEnvVarAsNumber(name: string, defaultValue?: number): number {
  const value = process.env[name];
  if (!value && defaultValue === undefined) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value ? parseInt(value, 10) : defaultValue!;
}

function getEnvVarAsArray(name: string, separator = ','): string[] {
  return getEnvVar(name)
    .split(separator)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.database.url) {
    errors.push('DATABASE_URL is required');
  }

  if (!config.jwt.secret) {
    errors.push('JWT_SECRET is required');
  }

  if (!config.encryptionKey || config.encryptionKey.length < 32) {
    errors.push('ENCRYPTION_KEY is required and must be at least 32 characters long');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

export default config;
