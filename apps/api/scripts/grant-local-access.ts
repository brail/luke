/**
 * grant-local-access.ts
 *
 * Recovers an administrator when nobody can sign in: issues a single-use password-reset link for one
 * named, existing, active administrator, creating the LOCAL identity if the account has none. The
 * administrator sets the password on the normal reset page. It changes no role, activation,
 * approval or verification state. Every check, and what it prints, is in
 * `scripts/lib/grantLocalAccessCli.ts`; the procedure is in the API README, "Recovering
 * administrator access".
 *
 * The link is printed on standard output and nowhere else. Whoever can read that output can use it.
 *
 * Usage:
 *   In production, inside the API container (the image ships `dist-scripts`, the working directory
 *   is `/app/apps/api` and `DATABASE_URL` is already set; the database publishes no port):
 *     node dist-scripts/scripts/grant-local-access.js --username <name> [--anyway] [--yes] [--dry-run]
 *   Against a local or tunnelled database, with DATABASE_URL in apps/api/.env:
 *     pnpm --filter @luke/api db:grant-local-access --username <name>
 */

import { createInterface } from 'readline/promises';

import { runGrantLocalAccess } from './lib/grantLocalAccessCli.js';
import { createScriptPrismaClient } from './lib/prisma.js';

async function main() {
  const prisma = createScriptPrismaClient();
  const interactive = Boolean(process.stdin.isTTY);
  const terminal = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;

  try {
    process.exitCode = await runGrantLocalAccess(
      process.argv.slice(2),
      {
        out: line => console.log(line),
        err: line => console.error(line),
        interactive,
        ask: question => (terminal ? terminal.question(question) : Promise.resolve('')),
      },
      prisma,
      process.env.DATABASE_URL
    );
  } finally {
    terminal?.close();
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
