/**
 * Procedures that used to validate with an inline copy of a `@luke/core` schema now validate with
 * the schema itself. The LDAP settings form already validates with it; the template dialog does
 * not, and learns about the limit from the server's error.
 *
 * The copies had drifted: the milestone-template description had no length limit on the server
 * while core caps it at 500, and the LDAP search test capped the username at 256 while core did
 * not. The rejections below assert core's own message, which no inline copy carried, so putting a
 * copy back turns them red.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { setupTestDb, createCallerAs } from './helpers';

describe('procedures validate with the core schema', () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  describe('integrations.auth.testLdapSearch', () => {
    it('refuses a username over 256 characters with core’s message', async () => {
      const caller = await createCallerAs('admin');

      // The cause matters: with LDAP disabled in the suite the procedure also answers BAD_REQUEST
      // (`LDAP non è abilitato`), so only the parse issue proves the input was refused.
      await expect(
        caller.integrations.auth.testLdapSearch({ username: 'a'.repeat(257) }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        cause: {
          issues: [
            expect.objectContaining({
              path: ['username'],
              message: 'Username troppo lungo (max 256 caratteri)',
            }),
          ],
        },
      });
    });
  });

  describe('seasonCalendar templates', () => {
    const tooLong = {
      code: 'BAD_REQUEST',
      cause: {
        issues: [
          expect.objectContaining({
            path: ['description'],
            message: 'Descrizione troppo lunga (max 500 caratteri)',
          }),
        ],
      },
    };

    it('accepts a 500-character description and refuses 501 on create', async () => {
      const caller = await createCallerAs('admin');

      await expect(
        caller.seasonCalendar.createTemplate({ name: 'Too long', description: 'x'.repeat(501) }),
      ).rejects.toMatchObject(tooLong);

      const created = await caller.seasonCalendar.createTemplate({
        name: 'At the limit',
        description: 'x'.repeat(500),
      });
      expect(created.description).toHaveLength(500);
    });

    it('refuses 501 on update and applies a partial update', async () => {
      const caller = await createCallerAs('admin');
      const template = await caller.seasonCalendar.createTemplate({ name: 'SS' });

      await expect(
        caller.seasonCalendar.updateTemplate({ id: template.id, description: 'x'.repeat(501) }),
      ).rejects.toMatchObject(tooLong);

      const updated = await caller.seasonCalendar.updateTemplate({
        id: template.id,
        description: 'Spring/Summer',
      });
      expect(updated).toMatchObject({ name: 'SS', description: 'Spring/Summer' });
    });
  });
});
