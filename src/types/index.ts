import { IncomingHttpHeaders } from 'http';
import { ParsedQs } from 'qs';
import { Request as CoreRequest } from 'express-serve-static-core';
import * as jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';

export interface TenantContext {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  settings: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticatedRequest<
  TBody = any,
  TQuery = ParsedQs,
  TParams extends Record<string, string> = Record<string, string>,
> extends CoreRequest<TParams, any, TBody, TQuery> {
  headers: IncomingHttpHeaders;
  tenant?: TenantContext;
  apiKey?: {
    id: string;
    name: string;
    permissions: Record<string, any>;
  };
  requestId: string;
}

export interface DatabaseConfig {
  url: string;
}

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  apiVersion: string;
  apiVersionStatic: string;
  allowedOrigins: string[];
}

export interface JwtConfig {
  secret: jwt.Secret;
  expiresIn: StringValue | number;
}

export interface AppConfig {
  database?: DatabaseConfig;
  server: ServerConfig;
  jwt: JwtConfig;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  logLevel: string;
  logFile: string;
  encryptionKey: string;
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  timestamp: Date;
  services: {
    database: 'up' | 'down';
  };
  version: string;
  uptime: number;
}

export interface LoggerContext {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  paymentId?: string;
  method?: string;
  url?: string;
  service?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    timestamp: string;
    requestId: string;
    tenantId?: string;
    provider?: string;
  };
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}
