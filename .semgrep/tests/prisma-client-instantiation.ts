import { PrismaClient } from '@luke/db';

declare function createPrismaClient(url: string): PrismaClient;
declare const adapter: unknown;

export function bare() {
  // ruleid: luke-prisma-client-instantiation
  return new PrismaClient();
}

export function withAdapter() {
  // ruleid: luke-prisma-client-instantiation
  return new PrismaClient({ adapter });
}

export function sanctioned(url: string) {
  // ok: luke-prisma-client-instantiation
  return createPrismaClient(url);
}
