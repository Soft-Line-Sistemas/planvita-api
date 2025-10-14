import winston from "winston";
import path from "path";
import fs from "fs";
import { config } from "../config";
import { LoggerContext } from "../types";

// Ensure logs directory exists
const logsDir = path.dirname(config.logFile);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for structured logging
const customFormat = winston.format.combine(
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss.SSS",
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    // Sanitize sensitive data
    const sanitized = sanitizeLogData(info);
    return JSON.stringify(sanitized);
  }),
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: "HH:mm:ss",
  }),
  winston.format.colorize(),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...meta } = info;
    const metaStr = Object.keys(meta).length
      ? JSON.stringify(meta, null, 2)
      : "";
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  }),
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logLevel,
  format: customFormat,
  defaultMeta: {
    service: "planvita-api",
    version: config.server.apiVersion,
  },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: config.logFile,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),

    // Separate file for errors
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

// Add console transport for development
if (config.server.nodeEnv !== "production") {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    }),
  );
}

// Sanitize sensitive data from logs
function sanitizeLogData(data: any): any {
  const sensitiveFields = [
    "password",
    "token",
    "secret",
    "key",
    "authorization",
    "cardNumber",
    "cardCvv",
    "cardToken",
    "pixKey",
  ];

  if (typeof data !== "object" || data === null) {
    return data;
  }

  const sanitized = { ...data };

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  }

  // Recursively sanitize nested objects
  for (const key in sanitized) {
    if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeLogData(sanitized[key]);
    }
  }

  return sanitized;
}

// Enhanced logger with context support
export class Logger {
  private context: LoggerContext = {};

  constructor(context?: LoggerContext) {
    if (context) {
      this.context = context;
    }
  }

  private formatMessage(message: string, meta?: any) {
    return {
      message,
      ...this.context,
      ...meta,
    };
  }

  info(message: string, meta?: any) {
    logger.info(this.formatMessage(message, meta));
  }

  error(message: string, error?: Error | any, meta?: any) {
    const errorMeta =
      error instanceof Error
        ? {
            error: {
              name: error.name,
              message: error.message,
              stack: error.stack,
            },
          }
        : { error };

    logger.error(this.formatMessage(message, { ...errorMeta, ...meta }));
  }

  warn(message: string, meta?: any) {
    logger.warn(this.formatMessage(message, meta));
  }

  debug(message: string, meta?: any) {
    logger.debug(this.formatMessage(message, meta));
  }

  child(context: LoggerContext): Logger {
    return new Logger({ ...this.context, ...context });
  }
}

// Default logger instance
export const defaultLogger = new Logger();

// Export winston logger for direct use if needed
export { logger as winstonLogger };

export default Logger;
