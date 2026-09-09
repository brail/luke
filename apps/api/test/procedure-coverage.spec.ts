/**
 * Exactness of the coverage gate (`assertProcedureCoverage`).
 *
 * The gate's own declarations (`UNCOVERED_NAMESPACES`) are checked against the
 * live router by the integration run; these cases feed it synthetic artifacts
 * through its `declarations` parameter instead, so they need no database and
 * run in the unit tier.
 *
 * What they pin is the property the `system` entry violated: a declaration is
 * an exact statement about which procedures are uninvoked, not a floor. An
 * entry that keeps naming a procedure the suite now invokes — or one that was
 * deleted from the router — has to fail, or the declaration slowly stops
 * describing anything.
 */

import { describe, it, expect } from 'vitest';

import { assertProcedureCoverage } from './procedure-coverage';

import type { UsageArtifact } from './helpers/procedureCoverageShared';

function artifacts(discovered: string[], invoked: string[]): UsageArtifact[] {
  return [{ specFile: '/test/example.integration.spec.ts', discovered, invoked }];
}

const REASON = 'motivo scritto a mano, abbastanza lungo da non essere un segnaposto';

describe('assertProcedureCoverage — esattezza delle dichiarazioni', () => {
  it('accetta una procedura dichiarata e davvero mai invocata', () => {
    expect(() =>
      assertProcedureCoverage(artifacts(['system.triggerCalendarDigest'], []), {
        system: { reason: REASON, uncovered: ['system.triggerCalendarDigest'] },
      })
    ).not.toThrow();
  });

  it('rifiuta una procedura ora invocata rimasta nella dichiarazione', () => {
    // Explicit list: the invoked path is named, so the message can name it too.
    expect(() =>
      assertProcedureCoverage(artifacts(['system.a', 'system.b'], ['system.a']), {
        system: { reason: REASON, uncovered: ['system.a', 'system.b'] },
      })
    ).toThrow(/Dichiarate ma ora invocate \(o inesistenti\): system\.a/);

    // Counted form: the same staleness, seen as an arithmetic mismatch. This
    // is the shape the `system` entry had, with `about` gone from the router.
    // A count that fell can mean either more invocations or fewer procedures,
    // and the message has to offer both: `about` was a removal, and a
    // diagnostic that only ever says "a new test covers more" sends the
    // reader looking for a test that doesn't exist.
    expect(() =>
      assertProcedureCoverage(artifacts(['system.a', 'system.b'], ['system.a']), {
        system: { reason: REASON, uncovered: 2 },
      })
    ).toThrow(
      /dichiarate 2 procedure non invocate, ne risultano 1 — la suite ne invoca di più, oppure alcune sono state rimosse dal router/
    );
  });

  it('rifiuta una procedura mai invocata e non dichiarata', () => {
    expect(() =>
      assertProcedureCoverage(artifacts(['system.a', 'system.b'], ['system.a']), {
        system: { reason: REASON, uncovered: ['system.a'] },
      })
    ).toThrow(/Non invocate e non dichiarate: system\.b/);

    // Same defect one level up: the whole namespace has no declaration.
    expect(() =>
      assertProcedureCoverage(artifacts(['system.a'], []), {})
    ).toThrow(/nessuna\s+dichiarazione/);
  });
});
