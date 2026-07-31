/**
 * Test del catalogo Phase unificato.
 *
 * Il fuoco è l'invariante introdotta insieme a questa suite: `code` (es. "01")
 * non è più un campo libero passato dal client, ma è sempre derivato da `order`
 * (`codeForOrder` in `src/routers/phase.ts`) su `create`, `update` e `reorder`.
 * Prima, `code` e `order` potevano divergere — un admin poteva rinominare il
 * codice senza spostare la riga, lasciando un valore visivamente fuorviante
 * sulla posizione reale. Qui si verifica che la divergenza non sia più
 * possibile, non solo che i CRUD funzionino.
 *
 * `phase_catalog:update` è admin-only per design (commento in
 * `packages/core/src/auth/permissions.ts`: "modifica riservata ad admin,
 * dominio separato dal calendario") — editor ha solo `phase_catalog:read`, a
 * differenza del resto dei suoi domini `:*`. Testato esplicitamente perché è
 * un'eccezione facile da annullare per errore allineando phase_catalog agli
 * altri permessi editor.
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

  describe('accesso basato su permessi', () => {
    type Role = 'admin' | 'editor' | 'viewer';
    const ROLES: Role[] = ['admin', 'editor', 'viewer'];
    const contexts = {} as Record<Role, Context>;

    beforeEach(async () => {
      // `adminContext` esiste già (beforeEach esterno): non ricrea un utente
      // admin, riusa quel context. `createContextForRole` non è utilizzabile
      // qui per editor/viewer perché tronca i dati ad ogni chiamata — invocarlo
      // di nuovo cancellerebbe l'utente admin appena creato.
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
      // listAll è riservata a phase_catalog:update — solo admin la raggiunge qui.
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

      // Ogni chiamata è respinta dal middleware dei permessi prima di toccare
      // il database: nessuno stato condiviso fra le invocazioni, indipendenti.
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
