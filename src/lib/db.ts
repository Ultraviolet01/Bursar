import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __bursarPrisma?: PrismaClient };
export const db = g.__bursarPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__bursarPrisma = db;
