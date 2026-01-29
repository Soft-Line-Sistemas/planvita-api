import { PrismaClient } from '@prisma/client';

class PrismaInstance {
  private static _instance: PrismaClient;

  private constructor() {}

  public static get instance(): PrismaClient {
    if (!PrismaInstance._instance) {
      PrismaInstance._instance = new PrismaClient({
        log: ['query', 'error', 'info'],
      });
    }
    return PrismaInstance._instance;
  }
}

export const prisma = PrismaInstance.instance;
