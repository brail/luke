/**
 * Guards against block elements nested inside `<DialogDescription>`.
 *
 * The component renders a `<p>` (Radix `Primitive.p`), so a `<p>`, `<div>`, `<ol>` or `<ul>`
 * inside it is invalid HTML and React reports a hydration error. `asChild` is the fix: it makes
 * the description render the child element instead, keeping the `aria-describedby` wiring.
 *
 * Static rather than a render test on purpose. The breakage is invisible until the branch that
 * contains it renders — RestoreConfirmDialog had three descriptions with this shape and only the
 * one reachable in the common case ever reported an error, the other two sat latent. A scan sees
 * all of them at once, and needs neither jsdom nor a testing-library stack, which apps/web
 * deliberately does not have (see vitest.config.mts).
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const WEB_SRC = join(import.meta.dirname, '..', '..');

/** An opening DialogDescription tag, capturing its attributes. */
const OPEN_RE = /<DialogDescription([^>]*)>/g;
const BLOCK_RE = /<(p|div|ol|ul)[\s>]/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const file of walk(WEB_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const open of source.matchAll(OPEN_RE)) {
      if (open[1].includes('asChild')) continue;
      const bodyStart = open.index + open[0].length;
      const bodyEnd = source.indexOf('</DialogDescription>', bodyStart);
      if (bodyEnd === -1) continue;
      const block = BLOCK_RE.exec(source.slice(bodyStart, bodyEnd));
      if (block) {
        const line = source.slice(0, bodyStart).split('\n').length;
        violations.push(`${file.slice(file.indexOf('apps/'))}:${line} contiene <${block[1]}>`);
      }
    }
  }
  return violations;
}

describe('DialogDescription', () => {
  it('trova le descrizioni da controllare (guardia sullo scanner stesso)', () => {
    const total = walk(WEB_SRC)
      .map(f => (readFileSync(f, 'utf8').match(OPEN_RE) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('non annida elementi di blocco senza asChild', () => {
    expect(
      findViolations(),
      'DialogDescription rende un <p>: un <p>/<div>/<ol>/<ul> dentro è HTML non valido e rompe ' +
        "l'hydration. Usa <DialogDescription asChild> con un <div> come figlio."
    ).toEqual([]);
  });
});
