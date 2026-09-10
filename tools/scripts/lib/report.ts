/**
 * Repository root and problem format shared by the drift checkers.
 *
 * This exists for the same reason as `gitPaths.ts`: `check-docs-integrity` and
 * `check-skill-integrity` are the pair that tends to drift apart. `REPO_ROOT`
 * used to be calculated in three places with three different `..` depths, and
 * `Problem` plus the block that formats and throws it existed as two
 * character-for-character copies. A rule shared by two scripts belongs in one
 * place.
 */

import { join } from 'path';

/** Repository root, resolved relative to `tools/scripts/lib/`. */
export const REPO_ROOT = join(__dirname, '..', '..', '..');

/** A broken reference anchored to a file and line. */
export interface Problem {
  file: string;
  line: number;
  message: string;
}

/** `  file:line — message`, one per line. */
export function formatProblems(problems: Problem[]): string {
  return problems.map(p => `  ${p.file}:${p.line} — ${p.message}`).join('\n');
}
