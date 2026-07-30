/**
 * Registra quali procedure tRPC la suite di integrazione **invoca davvero**.
 *
 * ## Perché misurare invece di dichiarare
 *
 * Lo smoke E2E ha una guardia analoga sulle rotte (`shell.smoke.spec.ts`), ma là
 * la lista "coperte" si autodimostra: ogni voce *genera* un test, non puoi
 * elencarne una senza pagarla. Una lista di procedure coperte scritta a mano non
 * genera nulla: è l'affermazione che da qualche parte esiste un test per
 * `brand.list`, verificata da nessuno. Aggiungi la voce, cancella il test, e il
 * gate resta verde per sempre — cioè esattamente il difetto che questo progetto
 * ha passato una sessione intera a eliminare, reintrodotto dal suo stesso fix.
 *
 * Qui l'insieme "coperto" è **osservato**. Solo lo scoperto è dichiarato, e una
 * dichiarazione di assenza è autolimitante: al peggio sotto-dichiara.
 *
 * ## Cosa questo NON misura
 *
 * 1. **Raggiungibilità, non qualità delle asserzioni.** `auth.login` è invocata
 *    dalle spec sul rate limit, che sul login non asserisce nulla: risulterà
 *    invocata. Per questo i messaggi dicono sempre *invocata*, mai *coperta* —
 *    un gate che si autoincensa è peggio di nessun gate.
 * 2. Le procedure raggiungibili solo dalla produzione. È corretto così.
 * 3. **Le invocazioni su un sotto-router.** `router({ brand: brandRouter })` non
 *    conserva `brandRouter`: `createRouterFactory` ne ricostruisce un aggregato,
 *    quindi il sotto-router importato ha una propria mappa `_def.procedures` che
 *    non viene patchata. Una spec che fa `brandRouter.createCaller(ctx)` risulta
 *    perciò non aver invocato nulla.
 *
 *    Non è un buco da tappare: è il gate che segnala una scorciatoia. La
 *    produzione entra sempre da `appRouter`, e un test che parte dal sotto-router
 *    salta la composizione. La correzione sta nella spec —
 *    `appRouter.createCaller(ctx).brand` — non qui. È già successo con
 *    `brand.integration.spec.ts`, che il primo run del gate ha scoperto così.
 *
 * ## Meccanica
 *
 * Ogni voce di `appRouter._def.procedures` viene sostituita con un `Proxy`.
 * È il punto di strozzatura unico: sia `createCaller` (via `getProcedureAtPath`)
 * sia l'adapter HTTP risolvono da quella mappa, quindi nessun codice di
 * produzione va toccato e un futuro test tRPC via HTTP viene coperto gratis.
 *
 * Un `Proxy` con la sola trap `apply` inoltra ogni altro accesso all'originale:
 * `callProcedure` legge `proc._def.type` **prima** di invocare, e continua a
 * vederlo. Un wrapper a funzione avrebbe richiesto di ricopiare le proprietà a
 * mano.
 */

import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { afterAll, expect } from 'vitest';

import { appRouter } from '../../src/routers/index';

import { USAGE_DIR, type UsageArtifact } from './procedureCoverageShared';
import { discoverProcedures } from './procedureRegistry';


type ProcedureFn = (...args: unknown[]) => unknown;

/**
 * Installa il recorder per il file di spec corrente e ne scrive l'artefatto in
 * `afterAll`. Idempotente per file: vitest isola il registry dei moduli.
 */
export function installProcedureRecorder(): void {
  const discovered = discoverProcedures();
  const invoked = new Set<string>();

  const procedures = (
    appRouter._def as unknown as { procedures: Record<string, ProcedureFn> }
  ).procedures;

  for (const path of discovered) {
    const original = procedures[path];
    procedures[path] = new Proxy(original, {
      apply(target, thisArg, args) {
        invoked.add(path);
        return Reflect.apply(target, thisArg, args as unknown[]);
      },
    }) as ProcedureFn;
  }

  afterAll(() => {
    const specFile = expect.getState().testPath;

    // Senza il nome della spec il teardown non può distinguere una run completa
    // da una parziale, e il gate si disattiverebbe da solo in silenzio. Meglio
    // rumoroso: un fallback su un nome sintetico è come questo controllo
    // morirebbe senza che nessuno se ne accorga.
    if (!specFile) {
      throw new Error(
        '[procedure-coverage] `expect.getState().testPath` non disponibile: ' +
          'impossibile attribuire le invocazioni a un file di spec.'
      );
    }

    mkdirSync(USAGE_DIR, { recursive: true });
    const artifact: UsageArtifact = {
      specFile,
      discovered,
      invoked: [...invoked].sort(),
    };
    // Nome derivato dall'hash del path: evita collisioni fra spec omonime in
    // directory diverse senza dover sanificare separatori di percorso.
    const name = createHash('sha1').update(specFile).digest('hex');
    writeFileSync(join(USAGE_DIR, `${name}.json`), JSON.stringify(artifact));
  });
}
