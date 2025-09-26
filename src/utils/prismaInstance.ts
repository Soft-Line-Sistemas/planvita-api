import { PrismaClient } from "../../generated/prisma/client";

class PrismaInstance {
  private static _instance: PrismaClient;

  private constructor() {}

  public static get instance(): PrismaClient {
    if (!PrismaInstance._instance) {
      PrismaInstance._instance = new PrismaClient({
        log: ["error"],
      });
    }
    return PrismaInstance._instance;
  }
}

export const prisma = PrismaInstance.instance;
