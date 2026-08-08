/**
 * Types and constants shared by the procedure coverage gate.
 *
 * **This module must never import `appRouter`, neither directly nor
 * transitively.** `globalSetup.procedureCoverage.ts` runs in vitest's main
 * process, and importing the router drags us into the application's module
 * graph with its module-level side effects: verified, the process hangs
 * ("close timed out after 30000ms"). The first draft of this gate fell into
 * this trap, importing `USAGE_DIR` from a module that in turn imported the
 * router.
 *
 * Rule: whatever the main process needs lives here; whatever touches the
 * router lives in `procedureRegistry.ts` / `procedureUsage.ts`, imported only
 * by the workers.
 */

import { join } from 'path';

/**
 * Directory for the artifacts, one per spec file.
 *
 * Under `node_modules/` because it's already gitignored and deletable without
 * consequences. One file per spec and not a shared append log: concurrent
 * append is atomic only under `PIPE_BUF`, and a line with 300+ paths isn't.
 */
export const USAGE_DIR = join(
  __dirname,
  '..',
  '..',
  'node_modules',
  '.cache',
  'procedure-coverage'
);

export interface UsageArtifact {
  /** Absolute path of the spec file that produced the artifact. */
  specFile: string;
  /** Inventory observed by that spec, to detect divergences across workers. */
  discovered: string[];
  /** Dotted paths actually invoked. */
  invoked: string[];
}

/** Top-level namespace of a dotted path (`brand.list` → `brand`). */
export function namespaceOf(procedurePath: string): string {
  return procedurePath.split('.')[0];
}
