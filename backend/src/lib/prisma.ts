import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var _prisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  try {
    return new PrismaClient();
  } catch (err) {
    console.error('FATAL: PrismaClient() threw during init:', err);
    process.exit(1);
  }
}

export const prisma: PrismaClient =
  global._prisma ?? (global._prisma = createClient());
