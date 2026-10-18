import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import tsParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';

import { moduleReferenceVisitors } from '../lib/module-references.js';

/**
 * Pins the shape of every static reference form the shared visitor reports, against the
 * installed parser. A field rename in typescript-estree (`TSImportType.argument` → `source`
 * already happened once) would otherwise make a rule silent, not fail.
 */
function references(code) {
  const seen = [];
  // A flat config object without `files` matches only `**/*.{js,cjs,mjs}`; the probe is a `.ts`
  // file, so the surface is stated, and `cwd` is the file's own root so the pattern applies.
  const linter = new Linter({ cwd: '/x' });
  const config = {
    files: ['**/*.ts'],
    plugins: {
      probe: {
        rules: {
          record: {
            meta: { schema: [] },
            create: () => moduleReferenceVisitors((ref) => seen.push(`${ref.form}|${ref.specifier}|${ref.typeOnly}`)),
          },
        },
      },
    },
    languageOptions: { parser: tsParser },
    rules: { 'probe/record': 'error' },
  };
  const messages = linter.verify(code, config, { filename: '/x/y.ts' });
  assert.deepEqual(messages.filter((m) => m.fatal), [], 'the sample must parse');
  return seen;
}

describe('module-references', () => {
  it('reports every static form with its type-only flag', () => {
    assert.deepEqual(
      references(`
        import a from 'p-import';
        import type b from 'p-import-type';
        import { type c } from 'p-inline-type';
        import 'p-side-effect';
        export { d } from 'p-export-from';
        export type { e } from 'p-export-type';
        export * from 'p-export-all';
        const f = () => import('p-dynamic');
        const g = () => import(\`p-dynamic-template\`);
        const h = require('p-require');
        const i = require(\`p-require-template\`);
        import j = require('p-import-equals');
        type K = import('p-import-type-node').K;
        type L = typeof import('p-typeof-import');
      `),
      [
        'import|p-import|false',
        'import|p-import-type|true',
        'import|p-inline-type|true',
        'import|p-side-effect|false',
        'export-from|p-export-from|false',
        'export-type|p-export-type|true'.replace('export-type', 'export-from'),
        'export-all|p-export-all|false',
        'import()|p-dynamic|false',
        'import()|p-dynamic-template|false',
        'require()|p-require|false',
        'require()|p-require-template|false',
        'import = require()|p-import-equals|false',
        'import() type|p-import-type-node|true',
        'import() type|p-typeof-import|true',
      ]
    );
  });

  it('does not judge a specifier it cannot know statically', () => {
    assert.deepEqual(
      references(`
        const a = (m) => import(m);
        const b = (s) => import(\`p-\${s}\`);
        const c = (s) => require(s);
        const d = require.resolve('p-resolve');
      `),
      []
    );
  });

  it('reads TSImportType through its canonical source field', () => {
    // The literal must come from `node.source`; a rule that still read the deprecated `argument`
    // getter would see a TSLiteralType wrapper and be one parser release away from silence.
    const ast = tsParser.parse(`type X = import('p').Y;`);
    const node = ast.body[0].typeAnnotation;
    assert.equal(node.source.type, 'Literal');
    assert.equal(node.source.value, 'p');
    assert.deepEqual(references(`type X = import('p').Y;`), ['import() type|p|true']);
  });
});
