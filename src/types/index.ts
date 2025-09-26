export interface DatabaseConfig {
  url: string;
}

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  apiVersion: string;
  allowedOrigins: string[];
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
}

export interface AppConfig {
  database: DatabaseConfig;
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
