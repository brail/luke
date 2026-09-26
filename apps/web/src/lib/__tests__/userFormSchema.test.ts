import { describe, expect, it } from 'vitest';

import { buildUserPayload, type SyncedField } from '../userFormSchema';

const VALID_PASSWORD = 'TestPassw0rd!23';

const CREATE_FORM = {
  email: 'mario@example.com',
  username: 'mario',
  firstName: 'Mario',
  lastName: 'Rossi',
  password: VALID_PASSWORD,
  confirmPassword: VALID_PASSWORD,
  role: 'editor' as const,
  isActive: true,
};

const EDIT_FORM = { ...CREATE_FORM, password: '', confirmPassword: '' };

/**
 * The identity fields are the ones both modes take from `users.core.create`'s input. If create and
 * edit ever stop agreeing on them, an admin can save through one screen what the other refuses —
 * silently, because each screen is self-consistent.
 */
describe('create and edit judge identities the same way', () => {
  const cases: { field: 'email' | 'username' | 'role'; value: unknown }[] = [
    { field: 'email', value: 'non-una-email' },
    { field: 'username', value: 'ab' },
    { field: 'role', value: 'superuser' },
  ];

  for (const { field, value } of cases) {
    it(`rejects an invalid ${field} in both modes`, () => {
      const create = buildUserPayload('create', { ...CREATE_FORM, [field]: value }, []);
      const edit = buildUserPayload('edit', { ...EDIT_FORM, [field]: value }, []);
      expect(create.ok).toBe(false);
      expect(edit.ok).toBe(false);
      if (!create.ok && !edit.ok) {
        expect(Object.keys(create.errors)).toContain(field);
        expect(create.errors[field]).toBe(edit.errors[field]);
      }
    });
  }

  for (const field of ['email', 'username', 'role'] as const) {
    it(`rejects a missing ${field} in both modes`, () => {
      // Edit derives from `UpdateUserInputSchema`, where these are optional because a partial
      // update is legitimate on the wire. This form is not a partial update: it sends every field of
      // one row. Without this test the rebase would have made all three optional in silence.
      const { [field]: _omitted, ...createWithout } = CREATE_FORM;
      const { [field]: _omittedEdit, ...editWithout } = EDIT_FORM;
      expect(buildUserPayload('create', createWithout, []).ok).toBe(false);
      expect(buildUserPayload('edit', editWithout, []).ok).toBe(false);
    });
  }

  it('accepts the same valid identity in both modes', () => {
    expect(buildUserPayload('create', CREATE_FORM, []).ok).toBe(true);
    expect(buildUserPayload('edit', EDIT_FORM, []).ok).toBe(true);
  });
});

describe('confirmPassword never leaves the browser', () => {
  it('does not appear in the create payload', () => {
    const result = buildUserPayload('create', CREATE_FORM, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).not.toHaveProperty('confirmPassword');
  });

  it('does not appear in the edit payload, not even when the password is changed', () => {
    const result = buildUserPayload('edit', {
      ...EDIT_FORM,
      password: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    }, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).not.toHaveProperty('confirmPassword');
  });
});

describe('in edit an empty password means «keep the current one»', () => {
  it('omits the password key instead of sending it empty', () => {
    const result = buildUserPayload('edit', EDIT_FORM, []);
    expect(result.ok).toBe(true);
    // Not `password: ''`: a present key would be treated by the router as a password to hash.
    if (result.ok) expect('password' in result.payload).toBe(false);
  });

  it('sends the password when it was really typed', () => {
    const result = buildUserPayload('edit', {
      ...EDIT_FORM,
      password: VALID_PASSWORD,
      confirmPassword: VALID_PASSWORD,
    }, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.password).toBe(VALID_PASSWORD);
  });

  it('rejects a filled-in confirmation when the password is empty', () => {
    const result = buildUserPayload('edit', { ...EDIT_FORM, confirmPassword: 'qualcosa' }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.confirmPassword).toBe('Le password non coincidono');
  });

  it('in create la password resta obbligatoria', () => {
    const result = buildUserPayload('create', { ...CREATE_FORM, password: '', confirmPassword: '' }, []);
    expect(result.ok).toBe(false);
    // On the field, not on the result: with both empty `confirmPassword` fails too, so `ok === false`
    // alone would stay true even if the password rule disappeared.
    if (!result.ok) expect(result.errors.password).toBeDefined();
  });

  it('in create a password below the prefilter is rejected on its own field', () => {
    // The client-side boundary is the static prefilter, 8 characters: the floor no configuration
    // can go below. The *effective* minimum comes from the policy in AppConfig and is applied by the
    // server; the schema is compiled into the bundle and cannot know it, so this is all the form
    // itself can assert.
    const tooShort = 'Ab1!efg';
    const result = buildUserPayload('create', { ...CREATE_FORM, password: tooShort, confirmPassword: tooShort }, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.password).toBeDefined();
  });

  it('the prefilter does not replicate complexity: the policy decides that', () => {
    // Eight characters with no uppercase or symbol pass the form and are refused by the server.
    // Not an oversight: replicating the regexes here would mean rewriting a configurable rule
    // into a bundle that cannot know how it is configured — the defect this batch closes.
    const simple = 'abcdefgh';
    const result = buildUserPayload('create', { ...CREATE_FORM, password: simple, confirmPassword: simple }, []);
    expect(result.ok).toBe(true);
  });
});

describe('fields managed by an external provider', () => {
  it('are removed from the payload', () => {
    const synced: SyncedField[] = ['email', 'username'];
    const result = buildUserPayload('create', CREATE_FORM, synced);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).not.toHaveProperty('email');
      expect(result.payload).not.toHaveProperty('username');
      expect(result.payload.role).toBe('editor');
      expect(result.payload.isActive).toBe(true);
    }
  });

  it('validation still happens before the removal', () => {
    // Removing a field from the payload does not exempt it from the rules: otherwise a
    // misconfigured external provider would open a gap in what the form accepts.
    const result = buildUserPayload('create', { ...CREATE_FORM, email: 'rotta' }, ['email']);
    expect(result.ok).toBe(false);
    // The message, not just the outcome: stripping the field before validating would also fail,
    // but with "expected string, received undefined". Only the right order produces this one.
    if (!result.ok) expect(result.errors.email).toBe('Email non valida');
  });
});
