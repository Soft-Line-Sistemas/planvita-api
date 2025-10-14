import { Request, Response, NextFunction } from "express";
import { databaseManager} from '../utils/prisma';
import { HealthCheckResult } from "../types";
import { Logger } from "../utils/logger";
import { createSuccessResponse } from "../utils/helpers";
import config from "../config";

export class HealthController {
  private logger = new Logger({ service: "health-controller" });

  async healthCheck(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      this.logger.info("Health check request received");

      const startTime = Date.now();

      const databaseHealth = await databaseManager.healthCheck();

      const overallStatus = databaseHealth ? "healthy" : "unhealthy";

      const healthResult: HealthCheckResult = {
        status: overallStatus,
        timestamp: new Date(),
        services: {
          database: databaseHealth ? "up" : "down",
        },
        version: config.server.apiVersion,
        uptime: process.uptime(),
      };

      const responseTime = Date.now() - startTime;

      this.logger.info("Health check completed", {
        status: overallStatus,
        responseTime: `${responseTime}ms`,
        database: databaseHealth ? "up" : "down",
      });

      const statusCode = overallStatus === "healthy" ? 200 : 503;
      res.status(statusCode).json(createSuccessResponse(healthResult));
    } catch (error) {
      this.logger.error("Health check failed", error);

      const healthResult: HealthCheckResult = {
        status: "unhealthy",
        timestamp: new Date(),
        services: {
          database: "down",
        },
        version: config.server.apiVersion,
        uptime: process.uptime(),
      };

      res.status(503).json(createSuccessResponse(healthResult));
    }
  }

  async livenessCheck(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      this.logger.debug("Liveness check request received");

      res.json({
        alive: true,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
      });
    } catch (error) {
      this.logger.error("Liveness check failed", error);
      res.status(503).json({
        alive: false,
        reason: "Service is not responding properly",
      });
    }
  }

  async metricsCheck(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      this.logger.info("Metrics check request received");

      const metrics = {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        pid: process.pid,
        version: config.server.apiVersion,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      };

      res.json(createSuccessResponse(metrics));
    } catch (error) {
      this.logger.error("Metrics check failed", error);
      next(error);
    }
  }
}

export const healthController = new HealthController();
