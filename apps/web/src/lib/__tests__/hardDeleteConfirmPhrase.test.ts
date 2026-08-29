/**
 * Guards the typed confirmation on permanent deletions.
 *
 * A `hardDelete` is irreversible and the server now refuses one that carries only an id
 * (`HardDeleteConfirmSchema`). A call site that forgets `confirmPhrase` therefore ships a dialog
 * whose confirm button always fails — and nothing else would catch it: the props are optional by
 * design, so `tsc` is happy, and the failure only shows when somebody actually tries to delete.
 *
 * Static rather than a render test, for the same reason as `dialogDescriptionNesting`: it sees
 * every call site at once and needs neither jsdom nor a testing-library stack, which apps/web
 * deliberately does not have (see vitest.config.mts).
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const WEB_SRC = join(import.meta.dirname, '..', '..');

/** A whole `<ConfirmDialog … />` element, self-closing as every call site writes it. */
const CALL_SITE_RE = /<ConfirmDialog\b[\s\S]*?\/>/g;
const LITERAL_ACTION_TYPE_RE = /actionType="([a-zA-Z]+)"/;
const EXPRESSION_ACTION_TYPE_RE = /actionType=\{/;
const HAS_CONFIRM_PHRASE_RE = /confirmPhrase=/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

function callSites(): { file: string; line: number; block: string }[] {
  return walk(WEB_SRC).flatMap(file => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(CALL_SITE_RE)].map(match => ({
      file: file.slice(file.indexOf('apps/')),
      line: source.slice(0, match.index).split('\n').length,
      block: match[0],
    }));
  });
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const { file, line, block } of callSites()) {
    if (HAS_CONFIRM_PHRASE_RE.test(block)) continue;

    const literal = LITERAL_ACTION_TYPE_RE.exec(block);
    if (literal) {
      if (literal[1] === 'hardDelete') {
        violations.push(`${file}:${line} — actionType="hardDelete" senza confirmPhrase`);
      }
      continue;
    }

    // The type comes from a variable or a lookup, so the scanner cannot tell whether this site can
    // ever be a hardDelete. It fails rather than waving it through: a silent pass here is exactly
    // how the gate would go missing.
    if (EXPRESSION_ACTION_TYPE_RE.test(block)) {
      violations.push(
        `${file}:${line} — actionType è un'espressione: instrada anche confirmPhrase, oppure ` +
          'verifica a mano che quel ramo non possa mai valere hardDelete'
      );
    }
  }
  return violations;
}

describe('ConfirmDialog / hardDelete', () => {
  it('trova i call site da controllare (guardia sullo scanner stesso)', () => {
    expect(callSites().length).toBeGreaterThan(0);
  });

  it('riconosce sia gli actionType letterali sia quelli calcolati', () => {
    const blocks = callSites().map(c => c.block);
    expect(blocks.some(b => LITERAL_ACTION_TYPE_RE.test(b))).toBe(true);
    expect(blocks.some(b => EXPRESSION_ACTION_TYPE_RE.test(b))).toBe(true);
  });

  it('ogni eliminazione definitiva passa confirmPhrase', () => {
    expect(
      findViolations(),
      "Un'eliminazione definitiva senza confirmPhrase mostra un bottone che il server rifiuta " +
        'sempre: HardDeleteConfirmSchema pretende la frase digitata, non solo un id.'
    ).toEqual([]);
  });
});
