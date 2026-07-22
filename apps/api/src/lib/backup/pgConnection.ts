/**
 * Shared DATABASE_URL parsing and `pg_dump`/`pg_restore` process invocation for the backup engine.
 * Credentials always go through discrete `--host/--port/--username/--dbname` flags plus a
 * `PGPASSWORD` env var — never the raw connection string as a CLI argument, which would
 * otherwise be visible via `ps aux` or `/proc/<pid>/cmdline`.
 */

import { spawn } from 'child_process';

export interface PgConnectionParts {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

export function parseDatabaseUrl(): PgConnectionParts {
  // DATABASE_URL è bootstrap infrastrutturale (stessa var già letta direttamente in server.ts per
  // il client Prisma), qui serve solo per costruire gli argomenti CLI di pg_dump/pg_restore verso
  // lo stesso database — non un segreto applicativo da instradare via AppConfig.
  // nosemgrep: luke-no-direct-env
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL non impostata');
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

/**
 * Runs `pg_dump`/`pg_restore` (or any other libpq CLI tool) with credentials passed via
 * `PGPASSWORD`, rejecting on a non-zero exit with the captured stderr for diagnostics.
 */
export function runPgBinary(
  binary: 'pg_dump' | 'pg_restore',
  args: string[],
  password: string,
  stderrLimit = 4000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: { ...process.env, PGPASSWORD: password },
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${binary} exited with code ${code}: ${stderr.slice(0, stderrLimit)}`));
    });
  });
}
