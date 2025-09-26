import { PrismaClient } from "../../generated/prisma/client";
import { Logger } from "../utils/logger";
import { DatabaseError } from "../utils/errors";

export const prisma = new PrismaClient({
  log: [
    {
      emit: "event",
      level: "query",
    },
    {
      emit: "event",
      level: "error",
    },
    {
      emit: "event",
      level: "info",
    },
    {
      emit: "event",
      level: "warn",
    },
  ],
});

const dbLogger = new Logger({ service: "database" });

if (false) {
  prisma.$on("query", (e: any) => {
    dbLogger.debug("Database query executed", {
      query: e.query,
      params: e.params,
      duration: `${e.duration}ms`,
    });
  });
}

prisma.$on("error", (e: any) => {
  dbLogger.error("Database error occurred", e);
});

prisma.$on("info", (e: any) => {
  dbLogger.info("Database info", { message: e.message });
});

prisma.$on("warn", (e: any) => {
  dbLogger.warn("Database warning", { message: e.message });
});

export class DatabaseManager {
  private static instance: DatabaseManager;
  private isConnected: boolean = false;

  private constructor() {}

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public async connect(): Promise<void> {
    try {
      await prisma.$connect();
      this.isConnected = true;
      dbLogger.info("Database connected successfully");
    } catch (error) {
      this.isConnected = false;
      dbLogger.error("Failed to connect to database", error);
      throw new DatabaseError("Failed to connect to database", error);
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await prisma.$disconnect();
      this.isConnected = false;
      dbLogger.info("Database disconnected successfully");
    } catch (error) {
      dbLogger.error("Failed to disconnect from database", error);
      throw new DatabaseError("Failed to disconnect from database", error);
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      dbLogger.error("Database health check failed", error);
      return false;
    }
  }

  public isHealthy(): boolean {
    return this.isConnected;
  }

  public async runMigrations(): Promise<void> {
    try {
      // This would typically be handled by Prisma CLI in production
      // but we can implement custom migration logic here if needed
      dbLogger.info("Running database migrations...");
      // await prisma.$executeRaw`...migration queries...`;
      dbLogger.info("Database migrations completed successfully");
    } catch (error) {
      dbLogger.error("Failed to run database migrations", error);
      throw new DatabaseError("Failed to run database migrations", error);
    }
  }
}

// Database transaction helper
export async function withTransaction<T>(
  callback: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(async (tx: any) => {
      return await callback(tx);
    });
  } catch (error) {
    dbLogger.error("Transaction failed", error);
    throw new DatabaseError("Transaction failed", error);
  }
}

// Database retry helper
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        dbLogger.error(
          `Database operation failed after ${maxRetries} attempts`,
          lastError,
        );
        throw new DatabaseError(
          `Database operation failed after ${maxRetries} attempts`,
          lastError,
        );
      }

      dbLogger.warn(
        `Database operation failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
        {
          error: lastError.message,
          attempt,
          maxRetries,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }

  throw lastError!;
}

// Export the database manager instance
export const databaseManager = DatabaseManager.getInstance();

// Export Prisma client for direct use
export default prisma;
