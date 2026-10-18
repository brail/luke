import { describe, it } from 'node:test';

import tsParser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';

import rule from '../no-implicit-zone-date.js';

// RuleTester looks for global `describe`/`it`; under `node --test` they are importable but not
// global, so hand them over explicitly.
RuleTester.describe = describe;
RuleTester.it = it;

// The TypeScript parser: the rule must leave type positions (`Intl.DateTimeFormatOptions`) alone.
const ruleTester = new RuleTester({ languageOptions: { parser: tsParser, ecmaVersion: 'latest', sourceType: 'module' } });

const implicit = (form) => [{ messageId: 'implicitZone', data: { form } }];

ruleTester.run('no-implicit-zone-date', rule, {
  valid: [
    { name: 'UTC getters and setters', code: 'd.getUTCFullYear(); d.getUTCHours(); d.setUTCDate(1);' },
    { name: 'an instant built from a number, a Date, Date.UTC or nothing', code: 'new Date(0); new Date(d); new Date(Date.UTC(2026, 0, 1)); new Date();' },
    { name: 'an ISO string that names its offset', code: "new Date('2026-03-10T00:00:00Z'); new Date('2026-03-10T09:00:00+01:00'); new Date('2026-03-10T09:00:00+0100'); Date.parse('2026-03-10T09:00:00Z');" },
    { name: 'a template that names its offset', code: 'new Date(`${day}T00:00:00Z`); Date.parse(`${date}T${time}:00Z`);' },
    { name: 'a string variable: the rule cannot tell its form', code: 'new Date(row.startAt); Date.parse(row.startAt);' },
    { name: 'arithmetic on instants', code: 'new Date(Date.now() + 60_000); new Date(start.getTime() + duration); new Date(a + b);' },
    { name: 'the full ISO string of an instant, and ten characters of something else', code: "d.toISOString(); d.toISOString().slice(0, 7); token.substring(0, 10); s.split('T')[0];" },
    { name: 'Intl options as a type', code: 'const o: Intl.DateTimeFormatOptions = {}; type F = Intl.DateTimeFormat;' },
    { name: 'another Intl formatter', code: "new Intl.NumberFormat('it-IT').format(1);" },
    { name: 'a schema from core', code: 'z.object({ at: CalendarInstantSchema });' },
    { name: 'datetime on something that is not a zod string', code: 'schema.datetime(); iso.datetime();' },
    { name: 'a number formatted with toLocaleString', code: "n.toLocaleString('it-IT');" },
  ],
  invalid: [
    { name: 'a local getter', code: 'd.getHours();', errors: implicit('.getHours()') },
    { name: 'a local setter', code: 'd.setDate(d.getUTCDate() + 1);', errors: implicit('.setDate()') },
    { name: 'the local offset', code: 'd.getTimezoneOffset();', errors: implicit('.getTimezoneOffset()') },
    { name: 'a local formatter', code: "d.toLocaleDateString('it-IT');", errors: implicit('.toLocaleDateString()') },
    { name: 'a local date string', code: 'd.toDateString();', errors: implicit('.toDateString()') },
    { name: 'new Date with fields', code: 'new Date(2026, 2, 10);', errors: implicit('new Date(y, m, …)') },
    { name: 'new Date with a date-only literal', code: "new Date('2026-03-10');", errors: implicit('new Date(<string without Z>)') },
    { name: 'new Date with a template', code: 'new Date(`${day}T09:00:00`);', errors: implicit('new Date(`…`)') },
    { name: 'new Date with a concatenation', code: "new Date(day + 'T09:00');", errors: implicit('new Date(<concatenation>)') },
    { name: 'new Date with a longer concatenation', code: "new Date(day + 'T' + time);", errors: implicit('new Date(<concatenation>)') },
    { name: 'Date.parse of a date-only literal', code: "Date.parse('2026-03-10');", errors: implicit('Date.parse(<string without Z>)') },
    { name: 'Date.parse of a template without an offset', code: 'Date.parse(`${day}T09:00`);', errors: implicit('Date.parse(`…`)') },
    { name: 'Intl.DateTimeFormat called', code: 'Intl.DateTimeFormat().resolvedOptions().timeZone;', errors: implicit('Intl.DateTimeFormat') },
    { name: 'Intl.DateTimeFormat constructed', code: "new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC' });", errors: implicit('Intl.DateTimeFormat') },
    { name: 'the UTC date of an instant', code: 'd.toISOString().slice(0, 10);', errors: implicit('.toISOString().slice(0, 10)') },
    { name: 'the UTC date of an instant, other spellings', code: "d.toISOString().substring(0, 10); d.toJSON().slice(0, 10); d.toISOString().split('T')[0];", errors: [...implicit('.toISOString().substring(0, 10)'), ...implicit('.toISOString().slice(0, 10)'), ...implicit(".toISOString().split('T')[0]")] },
    { name: 'a raw datetime schema', code: 'z.string().datetime(); z.iso.datetime();', errors: [{ messageId: 'datetimeSchema' }, { messageId: 'datetimeSchema' }] },
    { name: 'a homonymous method is reported too, for an exemption to state why', code: 'calendar.getDate();', errors: implicit('.getDate()') },
  ],
});
