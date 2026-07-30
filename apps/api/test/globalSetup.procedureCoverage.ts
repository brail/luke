/**
 * Gate di copertura delle procedure tRPC, agganciato al ciclo di vita di vitest.
 *
 * Vive **dentro** `pnpm test:integration` e non come step separato di CI: uno
 * step si può dimenticare di aggiungere, un `globalSetup` no.
 *
 * `globalSetup` gira nel processo principale, quindi qui non si importa mai
 * `src/routers/index`: trascinerebbe dentro il module graph dell'applicazione e
 * i suoi side effect a livello di modulo (verificato: importarlo fuori da vitest
 * lascia il processo appeso). La discovery avviene nei worker, via
 * `setup.procedureUsage.ts`; qui si leggono solo JSON.
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
 * Tutte le spec di integrazione presenti su disco.
 *
 * `readdirSync` ricorsivo invece di una dipendenza glob: nessun pacchetto nuovo,
 * e la stessa forma della guardia rotte in `shell.smoke.spec.ts`.
 */
function discoverSpecFiles(): string[] {
  return readdirSync(TEST_DIR, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(SPEC_SUFFIX))
    .map(entry => join(entry.parentPath ?? TEST_DIR, entry.name))
    .sort();
}

export default async function setup(): Promise<() => Promise<void>> {
  // La riga più importante del file. Un artefatto rimasto da una run precedente
  // verrebbe contato come copertura di questa: è il modo esatto in cui il gate
  // diventerebbe verde per sempre la prima volta che si rinomina una spec.
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
      // Run parziale: il gate non può pronunciarsi sulla copertura complessiva.
      //
      // L'escape è **derivato**, non dichiarato: nessuna variabile da impostare
      // e quindi da dimenticare accesa. In locale lanciare una spec sola è
      // normale e si avvisa; in CI la pipeline lancia sempre la suite intera,
      // quindi una run parziale è un difetto — e saltare in silenzio sarebbe
      // di nuovo il controllo dichiarato-e-mai-eseguito.
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
