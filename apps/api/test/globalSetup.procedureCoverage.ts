/**
 * tRPC procedure coverage gate, hooked into vitest's lifecycle.
 *
 * Lives **inside** `pnpm test:integration` and not as a separate CI step: a
 * step can be forgotten when adding one; a `globalSetup` can't.
 *
 * `globalSetup` runs in the main process, so `src/routers/index` is never
 * imported here: it would drag in the application's module graph and its
 * module-level side effects (verified: importing it outside vitest leaves
 * the process hanging). Discovery happens in the workers, via
 * `setup.procedureUsage.ts`; only JSON is read here.
 */

import { existsSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

import {
  USAGE_DIR,
  type UsageArtifact,
} from './helpers/procedureCoverageShared';
import { assertProcedureCoverage } from './procedure-coverage';

const TEST_DIR = __dirname;
const SPEC_SUFFIX = '.integration.spec.ts';

/**
 * All integration specs present on disk.
 *
 * Recursive `readdirSync` instead of a glob dependency: no new package, and
 * the same shape as the route guard in `shell.smoke.spec.ts`.
 */
function discoverSpecFiles(): string[] {
  return readdirSync(TEST_DIR, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(SPEC_SUFFIX))
    .map(entry => join(entry.parentPath ?? TEST_DIR, entry.name))
    .sort();
}

export default async function setup(): Promise<() => Promise<void>> {
  // The most important line in the file. An artifact left over from a
  // previous run would get counted as coverage for this one: that's exactly
  // how the gate would turn permanently green the first time a spec gets
  // renamed.
  rmSync(USAGE_DIR, { recursive: true, force: true });

  return async function teardown(): Promise<void> {
    const artifacts: UsageArtifact[] = existsSync(USAGE_DIR)
      ? readdirSync(USAGE_DIR)
          .filter(name => name.endsWith('.json'))
          .map(
            name =>
              JSON.parse(
                readFileSync(join(USAGE_DIR, name), 'utf8')
              ) as UsageArtifact
          )
      : [];

    const allSpecs = discoverSpecFiles();
    if (allSpecs.length === 0) {
      throw new Error(
        `[procedure-coverage] nessun file "*${SPEC_SUFFIX}" sotto ${TEST_DIR}. ` +
          'La convenzione di naming è cambiata: il gate non ha nulla su cui ' +
          'pronunciarsi, e tacere qui lo renderebbe inerte.'
      );
    }

    const ran = new Set(artifacts.map(a => a.specFile));
    const notRun = allSpecs.filter(spec => !ran.has(spec));

    if (notRun.length > 0) {
      // Partial run: the gate can't make a call on overall coverage.
      //
      // The escape hatch is **derived**, not declared: no variable to set
      // and therefore none to forget switched on. Running a single spec
      // locally is normal and gets a warning; in CI the pipeline always
      // runs the whole suite, so a partial run is a defect — and silently
      // skipping would again be the declared-and-never-run check.
      const summary = `run parziale: ${ran.size}/${allSpecs.length} spec hanno registrato`;
      if (process.env.CI) {
        throw new Error(
          `[procedure-coverage] ${summary}. Prime mancanti: ` +
            notRun.slice(0, 5).join(', ')
        );
      }
      console.warn(`[procedure-coverage] ${summary} — gate non applicato.`);
      return;
    }

    assertProcedureCoverage(artifacts);
  };
}
