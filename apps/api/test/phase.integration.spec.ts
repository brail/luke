/**
 * Tests for the unified Phase catalog.
 *
 * The focus is the invariant introduced together with this suite: `code` (e.g. "01")
 * is no longer a free field passed by the client, but is always derived from `order`
 * (`codeForOrder` in `src/routers/phase.ts`) on `create`, `update` and `reorder`.
 * Before, `code` and `order` could diverge -- an admin could rename the
 * code without moving the row, leaving a visually misleading value
 * about the actual position. Here it is verified that the divergence is no longer
 * possible, not just that the CRUD operations work.
 *
 * `phase_catalog:update` is admin-only by design (comment in
 * `packages/core/src/auth/permissions.ts`: "modification reserved to admin,
 * domain separate from the calendar") -- editor only has `phase_catalog:read`, unlike
 * the rest of its `:*` domains. Tested explicitly because it is
 * an exception that is easy to accidentally erase by aligning phase_catalog with the
 * editor's other permissions.
 */

import { TRPCError } from '@trpc/server';
import { describe, it, expect, beforeEach } from 'vitest';

import { appRouter } from '../src/routers/index';

import { expectUnauthorized } from './helpers';
import { createContextForRole } from './helpers/testContext';

import type { Context } from '../src/lib/trpc';

describe('Phase Router', () => {
  let adminContext: Context;

  beforeEach(async () => {
    adminContext = await createContextForRole('admin');
  });

  const caller = (ctx: Context) => appRouter.createCaller(ctx).phase;

  describe('create — code derivato da order', () => {
    it('assegna code "01" al primo elemento e "02" al successivo, senza order esplicito', async () => {
      const first = await caller(adminContext).create({
        value: 'DESIGN',
        label: 'Design',
      });
      expect(first.order).toBe(0);
      expect(first.code).toBe('01');

      const second = await caller(adminContext).create({
        value: 'SOURCING',
        label: 'Sourcing',
      });
      expect(second.order).toBe(1);
      expect(second.code).toBe('02');
    });

    it('deriva code da un order esplicito passato in create', async () => {
      const result = await caller(adminContext).create({
        value: 'LAUNCH',
        label: 'Lancio',
        order: 5,
      });

      expect(result.order).toBe(5);
      expect(result.code).toBe('06');
    });

    it('rifiuta un value duplicato con CONFLICT', async () => {
      await caller(adminContext).create({ value: 'DUP', label: 'Duplicato' });

      await expect(
        caller(adminContext).create({ value: 'DUP', label: 'Altro' })
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('update — code ricalcolato da order', () => {
    it('un update senza order lascia order e code invariati', async () => {
      const created = await caller(adminContext).create({
        value: 'PROTO',
        label: 'Prototipo',
      });
      expect(created.code).toBe('01');

      const updated = await caller(adminContext).update({
        id: created.id,
        data: { label: 'Prototipo v2' },
      });

      expect(updated.label).toBe('Prototipo v2');
      expect(updated.order).toBe(created.order);
      expect(updated.code).toBe('01');
    });

    it('un update che cambia order ricalcola code di conseguenza', async () => {
      const created = await caller(adminContext).create({
        value: 'MOVE',
        label: 'Da spostare',
      });
      expect(created.code).toBe('01');

      const updated = await caller(adminContext).update({
        id: created.id,
        data: { order: 9 },
      });

      expect(updated.order).toBe(9);
      expect(updated.code).toBe('10');
    });

    it('NOT_FOUND per id inesistente', async () => {
      await expect(
        caller(adminContext).update({
          id: '00000000-0000-0000-0000-000000000000',
          data: { label: 'x' },
        })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('reorder — code segue sempre la nuova posizione', () => {
    it('dopo un reorder, ogni fase ha code = posizione+1, indipendentemente da come è stata creata', async () => {
      const a = await caller(adminContext).create({ value: 'A', label: 'A' });
      const b = await caller(adminContext).create({ value: 'B', label: 'B' });
      const c = await caller(adminContext).create({ value: 'C', label: 'C' });
      expect([a.code, b.code, c.code]).toEqual(['01', '02', '03']);

      await caller(adminContext).reorder({ orderedIds: [c.id, a.id, b.id] });

      const all = await adminContext.prisma.phase.findMany({
        where: { id: { in: [a.id, b.id, c.id] } },
      });
      const byId = new Map(all.map(p => [p.id, p]));

      expect(byId.get(c.id)).toMatchObject({ order: 0, code: '01' });
      expect(byId.get(a.id)).toMatchObject({ order: 1, code: '02' });
      expect(byId.get(b.id)).toMatchObject({ order: 2, code: '03' });
    });
  });

  describe('list — includeInactive', () => {
    /** One active phase and one retired one, to distinguish the two sets. */
    async function seedActiveAndRetired() {
      const active = await caller(adminContext).create({ value: 'LIST_ATTIVA', label: 'Attiva' });
      const retired = await caller(adminContext).create({ value: 'LIST_RITIRATA', label: 'Ritirata' });
      await caller(adminContext).remove({ id: retired.id });
      return { active, retired };
    }

    it('senza input ritorna solo le fasi attive', async () => {
      const { active, retired } = await seedActiveAndRetired();
      const ids = (await caller(adminContext).list()).map(p => p.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(retired.id);
    });

    it('con includeInactive ritorna anche le ritirate: serve a risolvere le etichette dello storico', async () => {
      // A row that passed through a phase later retired keeps referencing it: without this
      // read the drawer would show a dash in place of data that actually exists.
      const { retired } = await seedActiveAndRetired();
      const ids = (await caller(adminContext).list({ includeInactive: true })).map(p => p.id);
      expect(ids).toContain(retired.id);
    });

    it('includeInactive: false è esplicitamente il default, non un caso speciale', async () => {
      const { retired } = await seedActiveAndRetired();
      const ids = (await caller(adminContext).list({ includeInactive: false })).map(p => p.id);
      expect(ids).not.toContain(retired.id);
    });

    it('resta dietro il permesso di lettura, non quello di scrittura come listAll', async () => {
      // The point of the change: historical labels are needed by anyone reading the layout, while
      // `listAll` (catalog management) stays admin-only.
      const viewer = await adminContext.prisma.user.create({
        data: { email: 'viewer-list@example.com', username: 'viewer-list', firstName: 'V', lastName: 'U', role: 'viewer', isActive: true },
      });
      const viewerCtx: Context = {
        ...adminContext,
        session: { user: { id: viewer.id, email: viewer.email, username: viewer.username, role: viewer.role, tokenVersion: viewer.tokenVersion } },
      };

      await expect(caller(viewerCtx).list({ includeInactive: true })).resolves.toBeInstanceOf(Array);
      await expect(caller(viewerCtx).listAll()).rejects.toBeInstanceOf(TRPCError);
    });
  });

  describe('remove — guard sulle fasi ancora in uso', () => {
    /** Minimal layout with a row on the given phase. `completedAt` decides whether the row is still
     * "in progress" in the eyes of the alert engine, i.e. whether the phase can be retired. */
    async function seedRowOnPhase(phaseId: string, completedAt: Date | null) {
      const prisma = adminContext.prisma;
      const [brand, season] = await Promise.all([
        prisma.brand.create({ data: { code: `GB${Date.now() % 100000}`, name: 'Guard Brand' } }),
        prisma.season.create({ data: { code: `GS${Date.now() % 100000}`, name: 'Guard Season', year: 2040 } }),
      ]);
      const layout = await prisma.collectionLayout.create({
        data: { brandId: brand.id, seasonId: season.id },
      });
      const [group, calendar] = await Promise.all([
        prisma.collectionGroup.create({ data: { collectionLayoutId: layout.id, name: 'G', order: 0 } }),
        prisma.seasonCalendar.create({ data: { brandId: brand.id, seasonId: season.id } }),
      ]);
      const planningGroup = await prisma.planningGroup.create({
        data: { calendarId: calendar.id, name: 'PG' },
      });
      await prisma.collectionLayoutRow.create({
        data: {
          collectionLayoutId: layout.id,
          groupId: group.id,
          planningGroupId: planningGroup.id,
          phaseId,
          gender: 'MAN',
          line: 'Linea',
          status: 'NEW',
          productCategory: 'TEST',
          completedAt,
        },
      });
      return { calendarId: calendar.id, planningGroupId: planningGroup.id };
    }

    it('rifiuta con CONFLICT se una riga aperta è ferma su quella fase', async () => {
      // Retiring it would silently drop it from badges, dashboard, and delay notifications.
      const phase = await caller(adminContext).create({ value: 'IN_USO', label: 'In uso' });
      await seedRowOnPhase(phase.id, null);

      await expect(caller(adminContext).remove({ id: phase.id })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      const after = await adminContext.prisma.phase.findUniqueOrThrow({ where: { id: phase.id } });
      expect(after.isActive).toBe(true);
    });

    it("il messaggio dice quante righe e in quale brand/stagione, non solo che la fase è in uso", async () => {
      const phase = await caller(adminContext).create({ value: 'CON_SCOPE', label: 'Con scope' });
      await seedRowOnPhase(phase.id, null);

      await expect(caller(adminContext).remove({ id: phase.id })).rejects.toThrow(/1 righe ancora aperte \(GB\d+\/GS\d+: 1\)/);
    });

    it('rifiuta se restano milestone non cancellate su quella fase, anche senza righe aperte', async () => {
      // Events survive the retirement of the phase and keep shifting which
      // deadline is active for the rows of their planning group.
      const phase = await caller(adminContext).create({ value: 'CON_EVENTI', label: 'Con eventi' });
      const { calendarId, planningGroupId } = await seedRowOnPhase(phase.id, new Date());
      await adminContext.prisma.calendarEvent.create({
        data: { calendarId, planningGroupId, phaseId: phase.id, title: 'Gate', startAt: new Date('2040-06-30') },
      });

      await expect(caller(adminContext).remove({ id: phase.id })).rejects.toThrow(/1 milestone di calendario/);
    });

    it('una milestone cancellata non blocca più il ritiro', async () => {
      const phase = await caller(adminContext).create({ value: 'EVENTO_CANC', label: 'Evento cancellato' });
      const { calendarId, planningGroupId } = await seedRowOnPhase(phase.id, new Date());
      await adminContext.prisma.calendarEvent.create({
        data: {
          calendarId, planningGroupId, phaseId: phase.id, title: 'Gate annullato',
          startAt: new Date('2040-06-30'), cancelledAt: new Date(),
        },
      });

      await expect(caller(adminContext).remove({ id: phase.id })).resolves.toEqual({ success: true });
    });

    it('una fase con sole righe concluse si ritira: è il caso della fase buona per le stagioni passate', async () => {
      // Completed rows have already stopped being measured, so deactivating does not turn off
      // any alert -- and that is what makes a phase retirable without archiving the seasons.
      const phase = await caller(adminContext).create({ value: 'STORICA', label: 'Storica' });
      await seedRowOnPhase(phase.id, new Date('2039-01-01'));

      await expect(caller(adminContext).remove({ id: phase.id })).resolves.toEqual({ success: true });
      const after = await adminContext.prisma.phase.findUniqueOrThrow({ where: { id: phase.id } });
      expect(after.isActive).toBe(false);
    });

    it('una fase mai usata resta ritirabile', async () => {
      const phase = await caller(adminContext).create({ value: 'MAI_USATA', label: 'Mai usata' });
      await expect(caller(adminContext).remove({ id: phase.id })).resolves.toEqual({ success: true });
    });
  });

  describe('accesso basato su permessi', () => {
    type Role = 'admin' | 'editor' | 'viewer';
    const ROLES: Role[] = ['admin', 'editor', 'viewer'];
    const contexts = {} as Record<Role, Context>;

    beforeEach(async () => {
      // `adminContext` already exists (outer beforeEach): it does not recreate an
      // admin user, it reuses that context. `createContextForRole` cannot be used
      // here for editor/viewer because it truncates the data on every call -- invoking it
      // again would delete the admin user just created.
      contexts.admin = adminContext;

      const [editor, viewer] = await Promise.all(
        (['editor', 'viewer'] as const).map(role =>
          adminContext.prisma.user.create({
            data: {
              email: `${role}-phase@example.com`,
              username: `${role}-phase`,
              firstName: role,
              lastName: 'User',
              role,
              isActive: true,
            },
          })
        )
      );
      for (const user of [editor, viewer]) {
        contexts[user.role as Role] = {
          ...adminContext,
          session: {
            user: {
              id: user.id,
              email: user.email,
              username: user.username,
              role: user.role,
              tokenVersion: user.tokenVersion,
            },
          },
        };
      }
    });

    const phaseAs = (role: Role | null) =>
      caller(role ? contexts[role] : { ...adminContext, session: null });

    it.each(ROLES)('%s può leggere il catalogo (list e listAll)', async role => {
      await expect(phaseAs(role).list()).resolves.toBeInstanceOf(Array);
      // listAll is reserved to phase_catalog:update -- only admin reaches it here.
      if (role === 'admin') {
        await expect(phaseAs(role).listAll()).resolves.toBeInstanceOf(Array);
      }
    });

    it('solo admin può creare una fase — editor è negato nonostante il resto dei suoi domini sia :*', async () => {
      await expect(
        phaseAs('admin').create({ value: 'ADMIN_ONLY', label: 'Admin only' })
      ).resolves.toMatchObject({ value: 'ADMIN_ONLY' });

      await expectUnauthorized(
        () => phaseAs('editor').create({ value: 'EDITOR_TRY', label: 'x' }),
        'FORBIDDEN'
      );
      await expectUnauthorized(
        () => phaseAs('viewer').create({ value: 'VIEWER_TRY', label: 'x' }),
        'FORBIDDEN'
      );
    });

    it('editor e viewer negati su update e reorder; non autenticato → UNAUTHORIZED', async () => {
      const created = await phaseAs('admin').create({
        value: 'RBAC_TARGET',
        label: 'Target',
      });

      const mutations: ((r: Role | null) => Promise<unknown>)[] = [
        r => phaseAs(r).update({ id: created.id, data: { label: 'y' } }),
        r => phaseAs(r).reorder({ orderedIds: [created.id] }),
      ];

      // Every call is rejected by the permissions middleware before touching
      // the database: no state is shared between the invocations, which are independent.
      await Promise.all(
        mutations.flatMap(invoke => [
          expectUnauthorized(() => invoke('editor'), 'FORBIDDEN'),
          expectUnauthorized(() => invoke('viewer'), 'FORBIDDEN'),
          expectUnauthorized(() => invoke(null), 'UNAUTHORIZED'),
        ])
      );
    });

    it('listAll (admin-only) nega editor e viewer', async () => {
      await expect(phaseAs('editor').listAll()).rejects.toBeInstanceOf(TRPCError);
      await expect(phaseAs('viewer').listAll()).rejects.toBeInstanceOf(TRPCError);
    });
  });
});
