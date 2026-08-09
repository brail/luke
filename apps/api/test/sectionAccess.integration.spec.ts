/**
 * Invariants of the `sectionAccess` router.
 *
 * The six procedures had no tests: `sectionAccess.spec.ts` exercises
 * `effectiveSectionAccess` and the counters with a fake Prisma, the router doesn't.
 *
 * `setRoleDefaults` in particular **is not reachable from the UI** — zero
 * callers in `apps/web`, in no script, nowhere. It's tRPC surface that can
 * lock out the system's administrators and that nothing has ever
 * executed: if someday someone builds a screen on top of it, the guard
 * behind it would face its first trial in production. Hence this suite.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach } from 'vitest';

import { SECTION_ACCESS_DEFAULTS } from '@luke/core';
import type { Role, Section } from '@luke/core';


import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';
import type { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

function callerFor(session: UserSession) {
  return createCallerWithSession(session).sectionAccess;
}

type Mode = 'enabled' | 'disabled' | 'auto';
type Defaults = Record<Role, Record<Section, Mode>>;

/**
 * Complete role defaults, derived from `SECTION_ACCESS_DEFAULTS`.
 *
 * `setRoleDefaultsInput` uses `z.record(sectionEnum, ...)`, which in Zod 4 is
 * **exhaustive**: every listed role must carry all sections. Building them by
 * hand with two entries seems to work until you read the schema — and a
 * real caller will have to do exactly this.
 */
function defaultsFor(
  overrides: Partial<Record<Role, Partial<Record<Section, Mode>>>> = {}
): Defaults {
  const base = Object.fromEntries(
    Object.entries(SECTION_ACCESS_DEFAULTS).map(([role, sections]) => [
      role,
      Object.fromEntries(
        Object.entries(sections).map(([section, allowed]) => [
          section,
          (allowed ? 'enabled' : 'disabled') as Mode,
        ])
      ),
    ])
  ) as Defaults;

  for (const [role, sections] of Object.entries(overrides)) {
    base[role as Role] = { ...base[role as Role], ...sections };
  }
  return base;
}

/** Defaults that leave the admin fully operational. */
function healthyDefaults(): Defaults {
  return defaultsFor();
}

// `beforeEach` and not `beforeAll`: the admins created by one test remain in
// the file's shared database and would add up to the next test's global
// count — the guards here count the admins *in the world*, not in the test.
beforeEach(async () => {
  prisma = await setupTestDb();
});

describe('sectionAccess — permessi delle procedure', () => {
  it('le procedure di scrittura e getByUser sono admin-only', async () => {
    const { user: target } = await createTestUser('admin');

    for (const role of ['editor', 'viewer'] as const) {
      const { session } = await createTestUser(role);
      const caller = callerFor(session);

      await expect(
        caller.getByUser({ userId: target.id })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await expect(
        caller.set({ userId: target.id, section: 'settings', enabled: false })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      await expect(
        caller.setRoleDefaults({ sectionAccessDefaults: healthyDefaults() })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('le letture su di sé sono aperte a ogni ruolo autenticato', async () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const { session } = await createTestUser(role);
      const caller = callerFor(session);

      await expect(caller.getDefaults()).resolves.toBeDefined();
      await expect(caller.getForMe()).resolves.toEqual([]);
      await expect(caller.getEffectiveForMe()).resolves.toBeDefined();
    }
  });
});

describe('sectionAccess — override per utente', () => {
  it('set scrive un override e getByUser lo rilegge', async () => {
    const { session: adminSession } = await createTestUser('admin');
    const { user: target } = await createTestUser('viewer');
    const caller = callerFor(adminSession);

    await caller.set({ userId: target.id, section: 'product', enabled: true });

    await expect(caller.getByUser({ userId: target.id })).resolves.toEqual([
      { section: 'product', enabled: true },
    ]);
  });

  it('enabled null rimuove l’override e torna alla modalità auto', async () => {
    const { session: adminSession } = await createTestUser('admin');
    const { user: target } = await createTestUser('viewer');
    const caller = callerFor(adminSession);

    await caller.set({ userId: target.id, section: 'product', enabled: false });
    const removed = await caller.set({
      userId: target.id,
      section: 'product',
      enabled: null,
    });

    // The contract says `null` when the override has been removed: distinguishing
    // "no override" from "override set to false" is the whole difference between
    // inheriting the role default and explicitly denying.
    expect(removed).toBeNull();
    await expect(caller.getByUser({ userId: target.id })).resolves.toEqual([]);
  });

  it('getForMe vede i propri override, non quelli altrui', async () => {
    const { session: adminSession } = await createTestUser('admin');
    const { user: other } = await createTestUser('viewer');
    const admin = callerFor(adminSession);

    await admin.set({ userId: other.id, section: 'product', enabled: true });

    await expect(admin.getForMe()).resolves.toEqual([]);
  });
});

describe('sectionAccess — getEffectiveForMe applica i quattro livelli', () => {
  it('senza config in AppConfig vale SECTION_ACCESS_DEFAULTS, non il fallback RBAC', async () => {
    // Level 2 used to read only AppConfig, and `rbac.sectionAccessDefaults` is
    // never seeded: with the key absent, every section resolved to `'auto'` and
    // deferred to the permissions fallback, so the static table didn't
    // participate in the evaluation. There were 32 divergences — a viewer could see
    // `settings.ldap`, `admin.brands`, `sales`. Now the table is the base.
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const { session } = await createTestUser(role);
      const effective = await callerFor(session).getEffectiveForMe();

      for (const [section, allowed] of Object.entries(
        SECTION_ACCESS_DEFAULTS[role]
      )) {
        expect(effective[section as Section], `${role}/${section}`).toBe(
          allowed
        );
      }
    }
  });

  it('una riga malformata in AppConfig non apre le sezioni', async () => {
    await prisma.appConfig.create({
      data: { key: 'rbac.sectionAccessDefaults', value: '{ questo non è JSON' },
    });
    const { session } = await createTestUser('viewer');

    // The `catch` used to degrade to an empty map, i.e. to the permissions fallback: a
    // visibility check that fails **open**. We stay on the
    // static base instead.
    const effective = await callerFor(session).getEffectiveForMe();
    expect(effective['settings.ldap']).toBe(false);
  });

  it('un override personale concede una sezione che i default negano', async () => {
    const { session: adminSession } = await createTestUser('admin');
    const { user: viewer, session: viewerSession } =
      await createTestUser('viewer');

    expect(
      (await callerFor(viewerSession).getEffectiveForMe())['settings.users']
    ).toBe(false);

    await callerFor(adminSession).set({
      userId: viewer.id,
      section: 'settings.users',
      enabled: true,
    });

    // Level 1 beats level 2: if this didn't change here, the override would be
    // written but nobody would read it — the UI would keep hiding
    // a section that was just granted.
    expect(
      (await callerFor(viewerSession).getEffectiveForMe())['settings.users']
    ).toBe(true);
  });
});

describe('sectionAccess — guard sull’ultimo amministratore', () => {
  it('setRoleDefaults rifiuta una config che chiude fuori tutti gli admin', async () => {
    const { session } = await createTestUser('admin');

    // `settings.users` set to `disabled` for the admin role: nobody could
    // create or promote anymore, so nobody could undo the change.
    // This is the path the guard covers and that the UI doesn't expose — nobody
    // had ever run it.
    await expect(
      callerFor(session).setRoleDefaults({
        sectionAccessDefaults: defaultsFor({
          admin: { 'settings.users': 'disabled' },
        }),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('setRoleDefaults rifiuta anche la revoca di settings', async () => {
    const { session } = await createTestUser('admin');

    await expect(
      callerFor(session).setRoleDefaults({
        sectionAccessDefaults: defaultsFor({ admin: { settings: 'disabled' } }),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('setRoleDefaults accetta una config che lascia gli admin operativi', async () => {
    const { session } = await createTestUser('admin');

    await expect(
      callerFor(session).setRoleDefaults({
        sectionAccessDefaults: healthyDefaults(),
      })
    ).resolves.toEqual({ success: true });
  });

  it('la scrittura invalida la cache RBAC: l’effetto è visibile subito', async () => {
    const { session } = await createTestUser('admin');
    const { session: viewerSession } = await createTestUser('viewer');

    const before = await callerFor(viewerSession).getEffectiveForMe();
    expect(before.product).toBe(true);

    await callerFor(session).setRoleDefaults({
      sectionAccessDefaults: defaultsFor({ viewer: { product: 'disabled' } }),
    });

    // `invalidateRbacCache()` is an explicit CLAUDE.md rule after every
    // write to RBAC keys. Without it, the subsequent read would serve the
    // old value until the cache expires — and the defect would only show up in
    // production, as a change that "doesn't take".
    const after = await callerFor(viewerSession).getEffectiveForMe();
    expect(after.product).toBe(false);
  });
});

describe('sectionAccess — è l’unica via di scrittura per rbac.*', () => {
  it('config.set rifiuta il prefisso rbac', async () => {
    const { session } = await createTestUser('admin');

    // The `setRoleDefaults` docstring declares itself the only reachable write
    // path for `rbac.sectionAccessDefaults`. If `config.set`
    // accepted that prefix, the last-admin guard could be bypassed by
    // writing the same key through the door next door.
    // Rejected by the input schema before the prefix check even runs:
    // the error code is a validation one, not FORBIDDEN. What matters is that
    // the write doesn't go through here.
    await expect(
      createCallerWithSession(session).config.set({
        key: 'rbac.sectionAccessDefaults',
        value: JSON.stringify({ admin: { settings: 'disabled' } }),
      })
    ).rejects.toThrow();

    await expect(
      prisma.appConfig.count({ where: { key: 'rbac.sectionAccessDefaults' } })
    ).resolves.toBe(0);
  });

  it('setRoleDefaults persiste davvero la chiave in AppConfig', async () => {
    const { session } = await createTestUser('admin');
    const defaults = defaultsFor({ editor: { product: 'disabled' } });

    await callerFor(session).setRoleDefaults({
      sectionAccessDefaults: defaults,
    });

    const row = await prisma.appConfig.findUnique({
      where: { key: 'rbac.sectionAccessDefaults' },
    });
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.value)).toMatchObject({
      editor: { product: 'disabled' },
    });
  });

  it('l’ultimo salvataggio vince, senza accumulare voci duplicate', async () => {
    const { session } = await createTestUser('admin');
    const caller = callerFor(session);

    await caller.setRoleDefaults({ sectionAccessDefaults: healthyDefaults() });
    await caller.setRoleDefaults({
      sectionAccessDefaults: defaultsFor({ viewer: { sales: 'enabled' } }),
    });

    const rows = await prisma.appConfig.findMany({
      where: { key: 'rbac.sectionAccessDefaults' },
    });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].value)).toMatchObject({
      viewer: { sales: 'enabled' },
    });
  });
});

describe('sectionAccess — validazione input', () => {
  it('rifiuta una sezione che non esiste', async () => {
    const { session } = await createTestUser('admin');
    const { user: target } = await createTestUser('viewer');

    await expect(
      callerFor(session).set({
        userId: target.id,
        // Made-up section: `sectionEnum` is the source of truth, and accepting it
        // would write an override that no evaluation will ever read.
        section: 'settings.inesistente' as never,
        enabled: true,
      })
    ).rejects.toThrow();
  });

  it('rifiuta uno stato che non è enabled/disabled/auto', async () => {
    const { session } = await createTestUser('admin');

    await expect(
      callerFor(session).setRoleDefaults({
        sectionAccessDefaults: defaultsFor({
          admin: { settings: 'forse' as never },
        }),
      })
    ).rejects.toThrow();
  });

  it('set su un utente inesistente non crea override orfani', async () => {
    const { session } = await createTestUser('admin');
    const ghost = randomUUID();

    await expect(
      callerFor(session).set({
        userId: ghost,
        section: 'product',
        enabled: true,
      })
    ).rejects.toThrow();

    await expect(
      prisma.userSectionAccess.count({ where: { userId: ghost } })
    ).resolves.toBe(0);
  });
});
