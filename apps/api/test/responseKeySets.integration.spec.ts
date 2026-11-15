/**
 * The exact keys of every response open to anyone or to every signed-in user, and of the responses
 * trimmed to what their screens read (#258): a field added to one of them fails here until someone
 * decides it belongs. The expected lists are written out, not derived from the production schemas,
 * and each response is read after a JSON round trip — what the wire carries — with fixtures that
 * fill every nested object.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { DEFAULT_STATE, writeMaintenanceState, type MaintenanceModeState } from '../src/lib/maintenanceMode';

import {
  TEST_USER_PASSWORD,
  buildTestServer,
  createAnonymousCaller,
  createCallerWithIP,
  createCallerWithSession,
  createTestUser,
  setupTestDb,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let admin: { user: { id: string; username: string }; session: UserSession };
let editor: { session: UserSession };

/** The keys of `value` as the client receives them, sorted; none for a missing one. */
const keysOf = (value: unknown): string[] =>
  value === undefined ? [] : Object.keys(JSON.parse(JSON.stringify(value))).sort();
const sorted = (...keys: string[]) => [...keys].sort();

const MAINTENANCE_VIEW = sorted('status', 'scheduledAt', 'activatedAt', 'message', 'warningsSent');
const REVISION_AUTHOR = sorted('firstName', 'lastName');

/** Every stored field set, so a field that leaks shows. */
const FULL_STATE: MaintenanceModeState = {
  ...DEFAULT_STATE,
  message: 'Manutenzione programmata',
  forceLogout: true,
  warningLeadMinutes: [15],
  warningsSent: [15],
  activatedByUserId: randomUUID(),
  notifyByEmail: true,
};

beforeAll(async () => {
  prisma = await setupTestDb();
  admin = await createTestUser('admin');
  editor = await createTestUser('editor');
});

describe('before sign-in', () => {
  it('public.ping', async () => {
    expect(keysOf(await (await createAnonymousCaller()).public.ping())).toEqual(['ok']);
  });

  it('public.passwordPolicy', async () => {
    expect(keysOf(await (await createAnonymousCaller()).public.passwordPolicy())).toEqual(
      sorted('minLength', 'requireUppercase', 'requireLowercase', 'requireDigit', 'requireSpecialChar', 'specialChars'),
    );
  });

  it('auth.login, and its user', async () => {
    const answer = await (await createCallerWithIP('10.26.0.1', null)).auth.login({
      username: admin.user.username,
      password: TEST_USER_PASSWORD,
    });

    expect(keysOf(answer)).toEqual(sorted('user', 'token', 'authMethod'));
    expect(keysOf(answer.user)).toEqual(
      sorted('id', 'email', 'username', 'firstName', 'lastName', 'role', 'isActive', 'tokenVersion'),
    );
  });

  it('/api/health and /, the routes the API registers', async () => {
    const server = await buildTestServer();
    try {
      const health = await server.inject({ method: 'GET', url: '/api/health' });
      const root = await server.inject({ method: 'GET', url: '/' });

      expect(keysOf(health.json())).toEqual(sorted('status', 'timestamp', 'uptime'));
      expect(keysOf(root.json())).toEqual(sorted('message', 'endpoints'));
    } finally {
      await server.close();
    }
  });
});

describe('every signed-in user', () => {
  it('me.get', async () => {
    expect(keysOf(await createCallerWithSession(editor.session).me.get())).toEqual(
      sorted(
        'id', 'email', 'username', 'firstName', 'lastName', 'role', 'isActive', 'emailVerifiedAt', 'locale',
        'timezone', 'provider', 'profileCompletion', 'dailyGreetingEnabled', 'createdAt', 'updatedAt', 'lastLoginAt',
        'loginCount',
      ),
    );
  });

  it.each([
    ['inactive', 'INACTIVE'],
    ['active', 'ACTIVE'],
  ] as const)('maintenance.mode.getStatus, %s, for an administrator and an editor', async (_name, status) => {
    await writeMaintenanceState(prisma, { ...FULL_STATE, status });
    try {
      for (const session of [admin.session, editor.session]) {
        expect(keysOf(await createCallerWithSession(session).maintenance.mode.getStatus())).toEqual(MAINTENANCE_VIEW);
      }
    } finally {
      // The tests after this one run outside a maintenance window.
      await writeMaintenanceState(prisma, DEFAULT_STATE);
    }
  });
});

describe('responses trimmed to what their screens read', () => {
  it('collection layout revisions: create, list, detail and as-of, and each author', async () => {
    const uid = randomUUID().substring(0, 6).toUpperCase();
    const [brand, season] = await Promise.all([
      prisma.brand.create({ data: { code: `KS${uid}`, name: `Keys Brand ${uid}`, isActive: true } }),
      prisma.season.create({ data: { code: `KS${uid}`, name: `Keys Season ${uid}`, year: 2035, isActive: true } }),
    ]);
    const caller = createCallerWithSession(admin.session);
    const layout = await caller.collectionLayout.getOrCreate({ brandId: brand.id, seasonId: season.id, availableGenders: ['MAN'] });

    const created = await caller.collectionLayoutRevision.create({
      collectionLayoutId: layout.id,
      revisionTypeValue: 'REVISIONE_PROGETTUALE',
      notes: 'Revisione di prova',
    });
    const [[summary], detail, asOf] = await Promise.all([
      caller.collectionLayoutRevision.list({ collectionLayoutId: layout.id }),
      caller.collectionLayoutRevision.getDetail({ revisionId: created.id }),
      caller.collectionLayoutRevision.getLayoutAsOf({ collectionLayoutId: layout.id, revisionId: created.id }),
    ]);

    const SUMMARY = sorted(
      'id', 'revisionNumber', 'revisionTypeValue', 'cause', 'milestoneId', 'notes', 'createdAt', 'createdBy', 'rowCount',
    );
    const DETAIL = sorted(
      'id', 'collectionLayoutId', 'revisionNumber', 'revisionTypeValue', 'cause', 'milestoneId', 'notes', 'createdAt',
      'createdBy', 'groups',
    );
    expect(keysOf(created)).toEqual(DETAIL);
    expect(keysOf(detail)).toEqual(DETAIL);
    expect(keysOf(summary)).toEqual(SUMMARY);
    expect(keysOf(asOf.revision)).toEqual(SUMMARY);
    for (const revision of [created, detail, summary, asOf.revision]) {
      expect(keysOf(revision.createdBy)).toEqual(REVISION_AUTHOR);
    }
  });

  it('users.list and users.listPending, and each identity', async () => {
    const pending = await prisma.user.create({
      data: {
        email: `keys-pending-${randomUUID()}@example.com`,
        username: `keys-pending-${randomUUID().substring(0, 8)}`,
        role: 'viewer',
        isActive: true,
        pendingApproval: true,
        timezone: 'Europe/Rome',
      },
    });
    await prisma.identity.create({ data: { userId: pending.id, provider: 'LDAP', providerId: pending.username } });
    const caller = createCallerWithSession(admin.session);

    const list = await caller.users.list({ search: admin.user.username });
    const listed = list.users.find(user => user.id === admin.user.id);
    const { users: pendingUsers } = await caller.users.listPending();
    const waiting = pendingUsers.find(user => user.id === pending.id);

    expect(keysOf(listed)).toEqual(
      sorted(
        'id', 'email', 'username', 'firstName', 'lastName', 'role', 'isActive', 'emailVerifiedAt', 'createdAt',
        'updatedAt', 'lastLoginAt', 'identities', 'isOnline',
      ),
    );
    expect(keysOf(listed?.identities[0])).toEqual(sorted('id', 'provider'));
    expect(keysOf(waiting)).toEqual(
      sorted('id', 'email', 'username', 'firstName', 'lastName', 'role', 'createdAt', 'identities'),
    );
    expect(keysOf(waiting?.identities[0])).toEqual(['provider']);
  });
});
