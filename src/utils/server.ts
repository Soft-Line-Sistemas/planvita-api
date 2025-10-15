import { databaseManager } from '../utils/prisma';
import { Logger } from './logger';
import config from '../config';

const logger = new Logger({ service: 'main' });
let server: any;
export { server };

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async (error: any) => {
    if (error) {
      logger.error('Error during server shutdown', error);
      process.exit(1);
    }

    try {
      // Disconnect from database
      await databaseManager.disconnect();
      logger.info('Database disconnected successfully');

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (shutdownError) {
      logger.error('Error during graceful shutdown', shutdownError);
      process.exit(1);
    }
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

export async function startServer(app: any): Promise<void> {
  try {
    // Connect to database
    await databaseManager.connect();
    logger.info('Database connected successfully');

    // Start HTTP server
    server = app.listen(config.server.port, '0.0.0.0', () => {
      logger.info('VitalSoft API started successfully', {
        port: config.server.port,
        nodeEnv: config.server.nodeEnv,
        version: config.server.apiVersion,
        pid: process.pid,
      });

      logger.info('Available endpoints:', {
        api: `http://localhost:${config.server.port}/api/v1`,
        health: `http://localhost:${config.server.port}/health`,
        // docs: `http://localhost:${config.server.port}/api-docs`,
      });
    });

    // Handle server errors
    server.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${config.server.port} is already in use`);
      } else {
        logger.error('Server error occurred', error);
      }
      process.exit(1);
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}
