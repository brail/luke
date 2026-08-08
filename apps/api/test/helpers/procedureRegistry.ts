/**
 * Inventory of the tRPC procedures mounted on `appRouter`.
 *
 * ## Why `_def.procedures` and not a file scan
 *
 * `src/routers/` doesn't map 1:1 onto namespaces: `integrations.ldap.router.ts`
 * is mounted on `integrations.auth`, and `users.core.router.ts` /
 * `users.admin.router.ts` are merged with `mergeRouters`, so their procedures
 * live directly on `users.*`. A filesystem scan would get both cases wrong.
 * The constructed router is the only source that has already resolved them.
 *
 * ## Shape of the map
 *
 * `_def.procedures` is **flat**, with dotted keys at any depth: in
 * `createRouterFactory` the construction is
 * `procedures[[...path, key].join('.')] = item`. The type declares `TRecord`
 * (the same as `_def.record`, which is nested instead) and this makes it
 * look nested: it isn't. Verified on @trpc/server 11.18.0.
 *
 * ## Unstable territory, hence explicit guards
 *
 * `_def` lives under `unstable-core-do-not-import`: a tRPC upgrade can change
 * its shape. Every assumption below is verified and fails hard. An empty
 * discovery that passed silently would turn the coverage gate into a
 * permanently green no-op — it already happened in this project with the
 * empty memoized table list in `helpers/database.ts`, which disabled
 * isolation between tests without anything flagging it.
 */

import { appRouter } from '../../src/routers/index';

interface RouterInternals {
  procedures?: Record<string, unknown>;
  record?: Record<string, unknown>;
}

/**
 * Dotted paths of every mounted procedure, sorted.
 *
 * @throws if the shape of `_def` is no longer the expected one — never an
 *   empty list returned silently.
 */
export function discoverProcedures(): string[] {
  // Cast needed: `_def` is typed as `RouterDef` with `procedures: TRecord`, a
  // recursive type that doesn't describe the actual flat map at runtime.
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

  // Cross-check between the two structures that tRPC builds in the same
  // pass but through different paths. Extends the guard beyond the "zero"
  // case: it also catches a partial shape change, where `procedures` stays
  // populated but loses some branches.
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
