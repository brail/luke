/**
 * Tipi e costanti condivisi del gate di copertura procedure.
 *
 * **Questo modulo non deve mai importare `appRouter`, né direttamente né per
 * transitività.** `globalSetup.procedureCoverage.ts` gira nel processo
 * principale di vitest, e importare il router ci trascina dentro il module graph
 * dell'applicazione con i suoi side effect a livello di modulo: verificato, il
 * processo resta appeso ("close timed out after 30000ms"). La prima stesura di
 * questo gate ci è cascata, importando `USAGE_DIR` da un modulo che a sua volta
 * importava il router.
 *
 * Regola: ciò che serve al processo principale sta qui; ciò che tocca il router
 * sta in `procedureRegistry.ts` / `procedureUsage.ts`, importati solo dai worker.
 */

import { join } from 'path';

/**
 * Directory degli artefatti, uno per file di spec.
 *
 * Sotto `node_modules/` perché è già ignorata da git e cancellabile senza
 * conseguenze. Un file per spec e non un log condiviso in append: l'append
 * concorrente è atomico solo sotto `PIPE_BUF`, e una riga con 300+ path non lo è.
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
  /** Path assoluto del file di spec che ha prodotto l'artefatto. */
  specFile: string;
  /** Inventario osservato da quella spec, per rilevare divergenze fra worker. */
  discovered: string[];
  /** Path dotted effettivamente invocati. */
  invoked: string[];
}

/** Namespace di primo livello di un path dotted (`brand.list` → `brand`). */
export function namespaceOf(procedurePath: string): string {
  return procedurePath.split('.')[0];
}
