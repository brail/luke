import { describe, it } from 'node:test';

import { RuleTester } from 'eslint';

import rule from '../audit-metadata-object-literal.js';

// RuleTester looks for global `describe`/`it`; under `node --test` they are importable but not
// global, so hand them over explicitly — otherwise every case collapses into one opaque file-level
// failure instead of being reported per case.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

ruleTester.run('audit-metadata-object-literal', rule, {
  valid: [
    {
      name: 'keys written out — the form the AuditMetadata type can actually check',
      code: `logAudit(ctx, { action: 'X', targetType: 'Y', metadata: { username: 'a', role: 'admin' } });`,
    },
    {
      name: 'a conditional value keeps the key literal, so it stays checked',
      code: `logAudit(ctx, { action: 'X', targetType: 'Y', metadata: { oldStartAt: changed ? a : undefined } });`,
    },
    {
      name: 'no metadata at all',
      code: `logAudit(ctx, { action: 'X', targetType: 'Y', result: 'SUCCESS' });`,
    },
    {
      name: 'a spread somewhere that is not audit metadata',
      code: `const row = { ...input, id };`,
    },
    {
      name: 'a metadata property on an unrelated call',
      code: `uploadFile({ metadata: someVar });`,
    },
  ],
  invalid: [
    {
      name: 'a bare variable — the type sees nothing at all',
      code: `logAudit(ctx, { action: 'X', targetType: 'Y', metadata: syncResult });`,
      errors: [{ messageId: 'notLiteral' }],
    },
    {
      name: 'spreading a whole procedure input',
      code: `logAudit(ctx, { action: 'X', targetType: 'Y', metadata: { ...input } });`,
      errors: [{ messageId: 'hasSpread' }],
    },
    {
      name: 'conditional spread: reads like a literal, is checked like a variable',
      code: `logAudit(ctx, { action: 'X', targetType: 'Y', metadata: { title: t, ...(changed && { oldEndAt: a }) } });`,
      errors: [{ messageId: 'hasSpread' }],
    },
    {
      name: 'awaited and member-called, the way the routers actually write it',
      code: `await auditLog.logAudit(ctx, { action: 'X', targetType: 'Y', metadata: { ...baseMeta, errorCode: c } });`,
      errors: [{ messageId: 'hasSpread' }],
    },
    {
      name: 'two spreads are two findings, so fixing one does not hide the other',
      code: `logAudit(ctx, { metadata: { ...a, ...b } });`,
      errors: [{ messageId: 'hasSpread' }, { messageId: 'hasSpread' }],
    },
  ],
});
