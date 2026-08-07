/**
 * Invarianti del router `sectionAccess`.
 *
 * Le sei procedure non avevano alcun test: `sectionAccess.spec.ts` esercita
 * `effectiveSectionAccess` e i contatori con un Prisma finto, il router no.
 *
 * `setRoleDefaults` in particolare **non è raggiungibile dalla UI** — zero
 * chiamanti in `apps/web`, in nessuno script, da nessuna parte. È superficie
 * tRPC che può azzerare gli amministratori del sistema e che nulla ha mai
 * eseguito: se un giorno qualcuno ci costruisce sopra una schermata, il guard
 * dietro sarebbe al primo collaudo in produzione. Da qui questa suite.
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
 * Default di ruolo completi, derivati da `SECTION_ACCESS_DEFAULTS`.
 *
 * `setRoleDefaultsInput` usa `z.record(sectionEnum, ...)`, che in Zod 4 è
 * **esaustivo**: ogni ruolo elencato deve portare tutte le sezioni. Costruirli a
 * mano con due voci sembra funzionare finché non si legge lo schema — e un
 * chiamante reale dovrà fare esattamente questo.
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

/** Default che lasciano l'admin pienamente operativo. */
function healthyDefaults(): Defaults {
  return defaultsFor();
}

// `beforeEach` e non `beforeAll`: gli admin creati da un test restano nel
// database condiviso del file e si sommerebbero al conteggio globale del
// successivo — i guard qui contano gli admin *del mondo*, non del test.
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

    // Il contratto dice `null` quando l'override è stato rimosso: distinguere
    // "nessun override" da "override a false" è tutta la differenza fra
    // ereditare il default di ruolo e negare esplicitamente.
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
  it('senza config in AppConfig decide il fallback RBAC, non SECTION_ACCESS_DEFAULTS', async () => {
    const { session } = await createTestUser('viewer');

    // Fatto contro-intuitivo, verificato: il 2° livello legge
    // `rbac.sectionAccessDefaults` da AppConfig, che **non è seedata**. Assente
    // quella chiave, ogni sezione risolve `'auto'` e decide il fallback sui
    // permessi. `SECTION_ACCESS_DEFAULTS` — la tabella statica che CLAUDE.md
    // tratta da fonte di verità — non entra mai nella valutazione.
    //
    // Un viewer ha `users:read`, e `settings.users` mappa lì: la sezione
    // risulta visibile benché la tabella statica la dia `false`. Il test lo
    // fissa perché è il comportamento reale, non perché sia quello voluto —
    // vedi la nota nel report della sessione.
    const effective = await callerFor(session).getEffectiveForMe();
    expect(effective['settings.users']).toBe(true);
  });

  it('un override personale nega una sezione che il fallback concederebbe', async () => {
    const { session: adminSession } = await createTestUser('admin');
    const { user: viewer, session: viewerSession } =
      await createTestUser('viewer');

    expect(
      (await callerFor(viewerSession).getEffectiveForMe())['settings.users']
    ).toBe(true);

    await callerFor(adminSession).set({
      userId: viewer.id,
      section: 'settings.users',
      enabled: false,
    });

    // Livello 1 batte livello 3: se qui non cambiasse, l'override sarebbe
    // scritto ma non lo leggerebbe nessuno — la UI continuerebbe a mostrare
    // una sezione revocata.
    expect(
      (await callerFor(viewerSession).getEffectiveForMe())['settings.users']
    ).toBe(false);
  });
});

describe('sectionAccess — guard sull’ultimo amministratore', () => {
  it('setRoleDefaults rifiuta una config che chiude fuori tutti gli admin', async () => {
    const { session } = await createTestUser('admin');

    // `settings.users` a `disabled` per il ruolo admin: nessuno potrebbe più
    // creare né promuovere, quindi nessuno potrebbe annullare la modifica.
    // È il percorso che il guard copre e che la UI non espone — nessuno lo
    // aveva mai eseguito.
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

    // `invalidateRbacCache()` è una regola esplicita di CLAUDE.md dopo ogni
    // write su chiavi RBAC. Senza, la lettura successiva servirebbe il valore
    // vecchio finché la cache non scade — e il difetto si vedrebbe solo in
    // produzione, come una modifica che "non prende".
    const after = await callerFor(viewerSession).getEffectiveForMe();
    expect(after.product).toBe(false);
  });
});

describe('sectionAccess — è l’unica via di scrittura per rbac.*', () => {
  it('config.set rifiuta il prefisso rbac', async () => {
    const { session } = await createTestUser('admin');

    // Il docstring di `setRoleDefaults` dichiara di essere l'unico percorso di
    // scrittura raggiungibile per `rbac.sectionAccessDefaults`. Se `config.set`
    // accettasse quel prefisso, il guard sull'ultimo admin sarebbe aggirabile
    // scrivendo la stessa chiave dalla porta accanto.
    // Rifiutato dallo schema di input prima ancora del controllo sul prefisso:
    // il codice d'errore è di validazione, non FORBIDDEN. Quel che conta è che
    // la scrittura non passi da qui.
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
        // Sezione inventata: `sectionEnum` è la fonte di verità, e accettarla
        // scriverebbe un override che nessuna valutazione leggerà mai.
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
