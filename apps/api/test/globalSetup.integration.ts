/**
 * Global setup of the integration project: one database per Vitest worker, then the procedure
 * coverage gate (`globalSetup.procedureCoverage.ts`).
 *
 * Files run in parallel. Each worker gets its own database, cloned from the template that
 * `TEST_DATABASE_URL` names once it is migrated, so `resetTestData` in one file never empties
 * another file's tables. Cloning copies the migrated schema, which no worker then migrates again.
 *
 * One file composes both setups because vitest runs global teardowns in a loop without a catch: a
 * separate teardown listed before the gate would be skipped whenever the gate throws, and its open
 * connection would hold the process until `teardownTimeout`.
 */

import { Client, DatabaseError } from 'pg';

import coverageSetup from './globalSetup.procedureCoverage';
import {
  migrateTestDatabase,
  requireTestDatabaseUrl,
  workerDatabaseUrl,
} from './helpers/database';

import type { TestProject } from 'vitest/node';

/** Advisory lock of an integration run, taken on the server's `postgres` database. */
const RUN_LOCK_KEY = 174_174;

/** Postgres truncates longer names, so two workers' databases could silently become one. */
const MAX_IDENTIFIER_BYTES = 63;

/** The database a URL names, as the server sees it (the URL path is percent-encoded). */
const databaseName = (url: string): string => decodeURIComponent(new URL(url).pathname.slice(1));

/** An identifier for SQL: identifiers cannot be parameters. */
const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

export default async function setup(
  project: TestProject
): Promise<() => Promise<void>> {
  const templateUrl = requireTestDatabaseUrl();
  const template = databaseName(templateUrl);

  // One session on `postgres`, never a pooled client: a pool closes idle connections, which would
  // drop the run lock mid-run, and a connection to the template would block every clone.
  const adminUrl = new URL(templateUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();

  try {
    // A second run would drop this run's databases under its feet: it stops here instead. The
    // lock lasts as long as this session, so a run that dies releases it.
    const { rows } = await admin.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [RUN_LOCK_KEY]
    );
    if (!rows[0]?.locked) {
      throw new Error(
        'Another integration run is using this test database server. Wait for it to finish: ' +
          'every run replaces the worker databases.'
      );
    }

    migrateTestDatabase(templateUrl);

    for (let id = 1; id <= project.config.maxWorkers; id++) {
      const name = databaseName(workerDatabaseUrl(templateUrl, String(id)));
      if (Buffer.byteLength(name) > MAX_IDENTIFIER_BYTES) {
        throw new Error(
          `Worker database "${name}" is longer than ${MAX_IDENTIFIER_BYTES} bytes: shorten the ` +
            'database name in TEST_DATABASE_URL.'
        );
      }
      // FORCE: a database left by a run that died may still have sessions.
      await admin.query(`DROP DATABASE IF EXISTS ${quoted(name)} WITH (FORCE)`);
      try {
        await admin.query(`CREATE DATABASE ${quoted(name)} TEMPLATE ${quoted(template)}`);
      } catch (error) {
        // 55006: someone is connected to the template (a database GUI, a `psql`).
        if (error instanceof DatabaseError && error.code === '55006') {
          throw new Error(
            `Cannot clone "${template}": another session is connected to it. Close database ` +
              'clients connected to it; test data lives in the worker databases.',
            { cause: error }
          );
        }
        throw error;
      }
    }

    const coverageTeardown = await coverageSetup();

    // No DROP here: teardown runs before the workers are closed, the next run drops them anyway,
    // and in CI the server is thrown away.
    return async () => {
      try {
        await coverageTeardown();
      } finally {
        await admin.end();
      }
    };
  } catch (error) {
    // Vitest registers the teardown only when setup returns: release the lock here.
    await admin.end();
    throw error;
  }
}
