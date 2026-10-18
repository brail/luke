import { describe, it } from 'node:test';

import { RuleTester } from 'eslint';

import rule from '../no-detached-jsdoc.js';

// RuleTester looks for global `describe`/`it`; under `node --test` they are importable but not
// global, so hand them over explicitly.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });

ruleTester.run('no-detached-jsdoc', rule, {
  valid: [
    { name: 'each JSDoc on its own declaration', code: '/** A */\nconst a = 1;\n\n/** B */\nfunction b() {}' },
    { name: 'a file header, a blank line, then a declaration JSDoc', code: '/**\n * Module overview.\n */\n\n/** A */\nconst a = 1;' },
    { name: 'a line comment between is not a JSDoc', code: '/** A */\n// note\nconst a = 1;' },
    { name: 'a plain block comment before a JSDoc', code: '/* header */\n/** A */\nconst a = 1;' },
  ],
  invalid: [
    {
      name: 'a JSDoc stacked on another one: the first lands on the wrong declaration',
      code: '/** Tooltip text. */\n/** Day-only format. */\nconst DAY_ONLY = {};\n\nexport function tooltip() {}',
      errors: [{ messageId: 'detached', line: 1 }],
    },
    {
      name: 'an orphaned JSDoc left above another declaration\'s',
      code: 'const a = 1;\n/**\n * Belongs to a constant that moved.\n */\n/** B */\nconst b = 2;',
      errors: [{ messageId: 'detached', line: 2 }],
    },
  ],
});
