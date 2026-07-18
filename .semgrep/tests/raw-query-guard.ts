import { PrismaClient, Prisma } from '@prisma/client';

declare function sanitizeCompany(company: string): string;
declare const mssqlPool: { request: () => { query: <T>(q: string) => Promise<T> } };

async function badPrisma(prisma: PrismaClient, id: string) {
  // ruleid: luke-prisma-raw-unsafe
  await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = '${id}'`);
}

async function badPrismaExecute(prisma: PrismaClient, id: string) {
  // ruleid: luke-prisma-raw-unsafe
  await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${id}'`);
}

async function goodPrisma(prisma: PrismaClient, id: string) {
  // ok: luke-prisma-raw-unsafe
  await prisma.$queryRaw(Prisma.sql`SELECT * FROM users WHERE id = ${id}`);
}

async function badNavQuery(company: string) {
  const req = mssqlPool.request();
  // ruleid: luke-nav-query-interpolation
  await req.query(`SELECT * FROM [${company}$Vendor]`);
}

async function goodNavQueryInline(config: { company: string }) {
  const req = mssqlPool.request();
  const tableName = `[${sanitizeCompany(config.company)}$Vendor]`;
  // ok: luke-nav-query-interpolation
  await req.query(`SELECT * FROM ${tableName}`);
}

async function goodNavQueryLocal(company: string) {
  const req = mssqlPool.request();
  const co = sanitizeCompany(company);
  // ok: luke-nav-query-interpolation
  await req.query(`SELECT 1 FROM [${co}$Sales Line]`);
}
