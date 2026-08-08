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
  // DATABASE_URL is infrastructure bootstrap (the same var already read directly in server.ts for
  // the Prisma client); here it's only used to build the pg_dump/pg_restore CLI arguments against
  // the same database — not an application secret that needs to be routed through AppConfig.
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

/** Inverse of `parseDatabaseUrl` — builds a full connection string, e.g. to override `DATABASE_URL` for a subprocess pointed at a different database (the migration bridge's temp DB). */
export function buildPostgresUrl(db: PgConnectionParts): string {
  return `postgresql://${encodeURIComponent(db.user)}:${encodeURIComponent(db.password)}@${db.host}:${db.port}/${db.database}`;
}

/** Spawns a child process, capturing stderr, resolving on exit code 0 — shared low-level primitive behind `runPgBinary` and `runCommand`. */
function spawnAndCapture(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; cwd?: string },
  stderrLimit: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(0, stderrLimit)}`));
    });
  });
}

/**
 * Runs `pg_dump`/`pg_restore`/`createdb`/`dropdb` (or any other libpq CLI tool) with credentials
 * passed via `PGPASSWORD`, rejecting on a non-zero exit with the captured stderr for diagnostics.
 */
export function runPgBinary(
  binary: 'pg_dump' | 'pg_restore' | 'createdb' | 'dropdb',
  args: string[],
  password: string,
  stderrLimit = 4000
): Promise<void> {
  return spawnAndCapture(binary, args, { env: { ...process.env, PGPASSWORD: password } }, stderrLimit);
}

/**
 * Runs an arbitrary command (e.g. `npx prisma migrate deploy`), optionally overriding env vars —
 * the migration bridge uses this to run `migrate deploy` against its temp database via an
 * overridden `DATABASE_URL`, the same command `entrypoint.sh` runs at boot.
 */
export function runCommand(
  command: string,
  args: string[],
  options: { env?: Partial<NodeJS.ProcessEnv>; cwd?: string } = {},
  stderrLimit = 4000
): Promise<void> {
  return spawnAndCapture(command, args, { env: { ...process.env, ...options.env }, cwd: options.cwd }, stderrLimit);
}
