/**
 * Inventario delle procedure tRPC montate su `appRouter`.
 *
 * ## Perché `_def.procedures` e non una scansione dei file
 *
 * `src/routers/` non mappa 1:1 sui namespace: `integrations.ldap.router.ts` è
 * montato su `integrations.auth`, e `users.core.router.ts` / `users.admin.router.ts`
 * sono uniti con `mergeRouters`, quindi le loro procedure vivono direttamente su
 * `users.*`. Una scansione del filesystem sbaglierebbe entrambi i casi. Il router
 * costruito è l'unica fonte che li ha già risolti.
 *
 * ## Forma della mappa
 *
 * `_def.procedures` è **piatta**, con chiavi dotted a qualunque profondità: in
 * `createRouterFactory` la costruzione è
 * `procedures[[...path, key].join('.')] = item`. Il tipo dichiara `TRecord` (lo
 * stesso di `_def.record`, che invece è annidata) e questo la fa sembrare
 * annidata: non lo è. Verificato su @trpc/server 11.18.0.
 *
 * ## Territorio instabile, quindi guardie esplicite
 *
 * `_def` sta sotto `unstable-core-do-not-import`: un upgrade di tRPC può
 * cambiarne la forma. Ogni assunzione qui sotto è verificata e fallisce forte.
 * Una discovery vuota che passasse in silenzio renderebbe il gate di copertura
 * un no-op verde per sempre — è già successo in questo progetto con la lista di
 * tabelle memoizzata vuota in `helpers/database.ts`, che disattivò l'isolamento
 * fra test senza che nulla lo segnalasse.
 */

import { appRouter } from '../../src/routers/index';

interface RouterInternals {
  procedures?: Record<string, unknown>;
  record?: Record<string, unknown>;
}

/**
 * Path dotted di ogni procedura montata, ordinati.
 *
 * @throws se la forma di `_def` non è più quella attesa — mai un elenco vuoto
 *   restituito in silenzio.
 */
export function discoverProcedures(): string[] {
  // Cast necessario: `_def` è tipizzato come `RouterDef` con `procedures: TRecord`,
  // un tipo ricorsivo che non descrive la mappa piatta effettiva a runtime.
  const def = appRouter._def as unknown as RouterInternals;
  const entries = Object.entries(def.procedures ?? {});

  if (entries.length === 0) {
    throw new Error(
      '[procedure-coverage] `appRouter._def.procedures` è vuoto. Non significa ' +
        '"nessuna procedura": significa che gli internals di tRPC sono cambiati. ' +
        'Aggiorna `discoverProcedures()` prima di proseguire — proseguire ' +
        'significherebbe un gate di copertura permanentemente verde.'
    );
  }

  const notCallable = entries.filter(([, value]) => typeof value !== 'function');
  if (notCallable.length > 0) {
    throw new Error(
      `[procedure-coverage] \`_def.procedures\` contiene ${notCallable.length} ` +
        `valori non invocabili (es. "${notCallable[0][0]}"): la mappa non è più ` +
        'piatta. Serve una visita ricorsiva di `_def.record`.'
    );
  }

  // Controllo incrociato fra le due strutture che tRPC costruisce nello stesso
  // passaggio ma per strade diverse. Estende la guardia oltre il caso "zero":
  // intercetta anche un cambio di forma parziale, dove `procedures` resta
  // popolata ma perde dei rami.
  const namespaces = new Set(entries.map(([path]) => path.split('.')[0]));
  const missing = Object.keys(def.record ?? {}).filter(
    key => !namespaces.has(key)
  );
  if (missing.length > 0) {
    throw new Error(
      '[procedure-coverage] namespace presenti in `_def.record` ma assenti da ' +
        `\`_def.procedures\`: ${missing.join(', ')}. Le due strutture sono ` +
        'divergenti: la mappa piatta non è più esaustiva.'
    );
  }

  return entries.map(([path]) => path).sort();
}
