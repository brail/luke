/**
 * Radice del repo e formato dei problemi, condivisi dai checker di drift.
 *
 * Stessa ragione di `gitPaths.ts`: `check-docs-integrity` e `check-skill-integrity`
 * sono la coppia che diverge. `REPO_ROOT` era calcolato in tre punti con tre
 * profondità diverse di `..`, e `Problem` + il blocco che lo formatta e lancia
 * erano due copie carattere per carattere. Una regola condivisa fra due script
 * deve stare in un posto solo.
 */

import { join } from 'path';

/** Radice del repo, risolta rispetto a `tools/scripts/lib/`. */
export const REPO_ROOT = join(__dirname, '..', '..', '..');

/** Un riferimento rotto, ancorato a file e riga. */
export interface Problem {
  file: string;
  line: number;
  message: string;
}

/** `  file:riga — messaggio`, una per riga. */
export function formatProblems(problems: Problem[]): string {
  return problems.map(p => `  ${p.file}:${p.line} — ${p.message}`).join('\n');
}
