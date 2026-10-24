/**
 * Setup file for the integration project only, listed first: points this worker at its own
 * database.
 *
 * Files run in parallel, one database per Vitest worker, cloned from the migrated template that
 * `TEST_DATABASE_URL` names (`globalSetup.integration.ts`). The template URL is kept aside the
 * first time: files normally start in a fresh fork, but without isolation this runs again in the
 * same process, where `TEST_DATABASE_URL` already names the worker database.
 * Not in `setup.ts`: the unit project shares that one.
 */

import { getTestDatabaseUrl, workerDatabaseUrl } from './helpers/database';

const poolId = process.env.VITEST_POOL_ID;
if (!poolId) {
  throw new Error(
    'VITEST_POOL_ID is unset: the integration project needs it to pick the worker database.'
  );
}

// No URL: left alone, so `helpers/database.ts` fails with its instructions.
const templateUrl = process.env.LUKE_TEST_TEMPLATE_URL ?? getTestDatabaseUrl();
if (templateUrl) {
  process.env.LUKE_TEST_TEMPLATE_URL = templateUrl;
  process.env.TEST_DATABASE_URL = workerDatabaseUrl(templateUrl, poolId);
}
