/**
 * Guards every flag the backup engine hands to a PostgreSQL CLI tool against that tool's own
 * `--help`.
 *
 * This exists because `restorePipeline.ts` shipped `pg_restore --exclude-table=public.audit_logs`.
 * That flag belongs to `pg_dump`; `pg_restore` rejects it outright, so the restore died before
 * touching anything — and since the option was wired to a checkbox that defaults to on, *every*
 * restore from the UI failed. Nothing in the type system can catch a wrong string in an argv
 * array, and the feature is destructive enough that nobody exercises it casually. Asking the
 * installed binary is the only check that would have.
 *
 * Reads the argv arrays out of the source rather than importing them, the same scanning approach
 * as `rawRouteProxy.spec.ts`: it covers every call site without reshaping the engine for
 * testability, and a new `runPgBinary` call is picked up with no wiring.
 */

import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const BACKUP_SRC = join(import.meta.dirname, '..', 'src', 'lib', 'backup');

/** Locates the start of a `runPgBinary('<binary>', [` call; the argv array is read separately. */
const CALL_RE = /runPgBinary\(\s*'([a-z_]+)'\s*,\s*\[/g;
/** A long option inside such an array, with or without an `=value` suffix. */
const FLAG_RE = /'(--[a-z-]+)(?:=[^']*)?'/g;
/**
 * A module-level constant holding a flag, e.g. `AUDIT_STAGE_EXCLUDE_ARG`.
 *
 * Not every flag reaches an argv array as a literal — `--exclude-schema` is defined once in
 * `auditStage.ts` and referenced by name. A literals-only scan cannot see those, which is exactly
 * the wrong blind spot: `--exclude-schema` is a `pg_dump` option that `pg_restore` rejects, the
 * same class of mistake this file exists to catch.
 */
const CONST_FLAG_RE = /const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*[`'"](--[a-z-]+)/g;
/** An identifier referenced inside an argv array — resolved against the constants above. */
const IDENT_RE = /\b([A-Z][A-Z0-9_]{2,})\b/g;

/**
 * Returns the argv array literal starting at `openIndex` (the `[`), matching brackets so nested
 * arrays are included. A non-greedy regex would stop at the first `]`, which in practice is the
 * inner array of a conditional spread like `...(clean ? ['--clean', '--if-exists'] : [])` — and
 * every flag after it would go unchecked, including the ones most likely to be wrong.
 */
function readArrayLiteral(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '[') depth++;
    else if (source[i] === ']' && --depth === 0) return source.slice(openIndex, i + 1);
  }
  throw new Error(`Array literal non chiuso a partire da ${openIndex}`);
}

interface FlagUse {
  binary: string;
  flag: string;
  file: string;
}

function collectFlagUses(): FlagUse[] {
  const sources = readdirSync(BACKUP_SRC)
    .filter(entry => entry.endsWith('.ts'))
    .map(entry => ({ entry, source: readFileSync(join(BACKUP_SRC, entry), 'utf8') }));

  // Constants first: an argv array may reference a flag by name instead of spelling it out.
  const constants = new Map<string, string>();
  for (const { source } of sources) {
    for (const decl of source.matchAll(CONST_FLAG_RE)) constants.set(decl[1], decl[2]);
  }

  const uses: FlagUse[] = [];
  for (const { entry, source } of sources) {
    for (const call of source.matchAll(CALL_RE)) {
      const argv = readArrayLiteral(source, call.index + call[0].length - 1);
      for (const flag of argv.matchAll(FLAG_RE)) {
        uses.push({ binary: call[1], flag: flag[1], file: entry });
      }
      for (const ident of argv.matchAll(IDENT_RE)) {
        const flag = constants.get(ident[1]);
        if (flag) uses.push({ binary: call[1], flag, file: entry });
      }
    }
  }
  return uses;
}

/** The long options a binary accepts, or null when it is not installed. */
function supportedFlags(binary: string): Set<string> | null {
  let help: string;
  try {
    help = execFileSync(binary, ['--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
  return new Set(Array.from(help.matchAll(/(--[a-z-]+)/g), m => m[1]));
}

describe('pg binary flags', () => {
  const uses = collectFlagUses();

  it('finds the call sites at all (guards the scanner against silently matching nothing)', () => {
    expect(uses.length).toBeGreaterThan(5);
    const pairs = uses.map(u => `${u.binary} ${u.flag}`);
    expect(pairs).toContain('pg_restore --exit-on-error');
    // Reached through a constant, not a literal — proves the indirection is resolved. This is the
    // pg_dump-only flag whose misuse on pg_restore is the failure mode this file guards.
    expect(pairs).toContain('pg_dump --exclude-schema');
  });

  const binaries = [...new Set(uses.map(u => u.binary))].sort();

  for (const binary of binaries) {
    it(`passes ${binary} only flags it accepts`, () => {
      const supported = supportedFlags(binary);
      if (!supported) {
        console.warn(`[pgBinaryFlags] ${binary} non installato — controllo saltato`);
        return;
      }

      const unknown = uses
        .filter(u => u.binary === binary && !supported.has(u.flag))
        .map(u => `${u.flag}  (${u.file})`);

      expect(
        unknown,
        `${binary} does not accept these flags. They fail at spawn time, so the operation dies ` +
          'before doing anything — check the flag against the right tool (pg_dump and pg_restore ' +
          'do NOT share their option sets).'
      ).toEqual([]);
    });
  }
});
