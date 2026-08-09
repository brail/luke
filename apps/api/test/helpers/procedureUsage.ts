/**
 * Records which tRPC procedures the integration suite **actually invokes**.
 *
 * ## Why measure instead of declare
 *
 * The E2E smoke test has an analogous guard on routes
 * (`shell.smoke.spec.ts`), but there the "covered" list proves itself: every
 * entry *generates* a test, you can't list one without paying for it. A
 * hand-written list of covered procedures generates nothing: it's the claim
 * that a test for `brand.list` exists somewhere, verified by no one. Add the
 * entry, delete the test, and the gate stays green forever — exactly the
 * defect this project spent an entire session eliminating, reintroduced by
 * its own fix.
 *
 * Here the "covered" set is **observed**. Only the uncovered part is
 * declared, and a declaration of absence is self-limiting: at worst it
 * under-declares.
 *
 * ## What this does NOT measure
 *
 * 1. **Reachability, not assertion quality.** `auth.login` is invoked by the
 *    rate-limit specs, which assert nothing about login itself: it will
 *    show up as invoked. That's why the messages always say *invoked*,
 *    never *covered* — a gate that congratulates itself is worse than no
 *    gate at all.
 * 2. Procedures reachable only from production. That's correct as is.
 * 3. **Invocations on a sub-router.** `router({ brand: brandRouter })`
 *    doesn't preserve `brandRouter`: `createRouterFactory` rebuilds an
 *    aggregate from it, so the imported sub-router has its own
 *    `_def.procedures` map that doesn't get patched. A spec that does
 *    `brandRouter.createCaller(ctx)` will therefore show up as having
 *    invoked nothing.
 *
 *    This isn't a hole to plug: it's the gate flagging a shortcut.
 *    Production always enters through `appRouter`, and a test that starts
 *    from the sub-router skips the composition. The fix belongs in the
 *    spec — `appRouter.createCaller(ctx).brand` — not here. This already
 *    happened with `brand.integration.spec.ts`, which the gate's first run
 *    caught this way.
 *
 * ## Mechanics
 *
 * Every entry of `appRouter._def.procedures` gets replaced with a `Proxy`.
 * This is the single choke point: both `createCaller` (via
 * `getProcedureAtPath`) and the HTTP adapter resolve from that map, so no
 * production code needs to be touched and a future tRPC-over-HTTP test gets
 * covered for free.
 *
 * A `Proxy` with only the `apply` trap forwards every other access to the
 * original: `callProcedure` reads `proc._def.type` **before** invoking, and
 * still sees it. A function wrapper would have required copying the
 * properties by hand.
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
 * Installs the recorder for the current spec file and writes its artifact in
 * `afterAll`. Idempotent per file: vitest isolates the module registry.
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

    // Without the spec name the teardown can't tell a complete run from a
    // partial one, and the gate would silently disable itself. Better noisy:
    // a fallback to a synthetic name is exactly how this check would die
    // without anyone noticing.
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
    // Name derived from the hash of the path: avoids collisions between
    // same-named specs in different directories without having to sanitize
    // path separators.
    const name = createHash('sha1').update(specFile).digest('hex');
    writeFileSync(join(USAGE_DIR, `${name}.json`), JSON.stringify(artifact));
  });
}
