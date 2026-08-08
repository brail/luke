/**
 * Router tRPC per il catalogo Phase unificato.
 * Sostituisce i due domini paralleli CollectionCatalogItem(type=progress) e
 * CalendarCatalogItem(type=eventType) con un unico ordinamento comparabile,
 * usato sia dallo stato di produzione delle righe collezione sia dal calendario.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { PhaseInputSchema, PhaseInputBaseSchema, partialWithoutDefaults } from '@luke/core';


import { logAudit } from '../lib/auditLog';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

/** Derives the display code from position: order 0 → "01", order 1 → "02", ... */
function codeForOrder(order: number): string {
  return String(order + 1).padStart(2, '0');
}

/** Riga aperta, ridotta al contesto che serve nel messaggio d'errore del guard. */
/** Righe aperte su una fase, già aggregate per layout: `{ codice brand/stagione → conteggio }`. */
type OpenRowsByScope = { scope: string; count: number }[];

/**
 * Messaggio del guard di `remove`: dice quante righe restano aperte e **dove** (brand/stagione),
 * più quante milestone insistono ancora sulla fase. Un "fase in uso" senza coordinate lascerebbe
 * l'admin a cercarle a mano fra tutti i layout.
 */
function describePhaseInUse(openRows: OpenRowsByScope, plannedEvents: number): string {
  const parts: string[] = [];

  const openCount = openRows.reduce((sum, r) => sum + r.count, 0);
  if (openCount > 0) {
    const breakdown = [...openRows]
      .sort((a, b) => a.scope.localeCompare(b.scope))
      .map(({ scope, count }) => `${scope}: ${count}`)
      .join(', ');
    parts.push(`${openCount} righe ancora aperte (${breakdown})`);
  }

  if (plannedEvents > 0) {
    parts.push(`${plannedEvents} milestone di calendario`);
  }

  return `Fase ancora in uso: ${parts.join(' e ')}. Concludi o sposta le righe, e cancella le milestone, prima di ritirarla.`;
}

export const phaseRouter = router({
  /**
   * Lists active phases, used to populate frontend selects.
   *
   * `includeInactive` serve a risolvere le **etichette** dello storico, non a popolare i picker: una
   * fase ritirata resta referenziata dalle righe che l'hanno attraversata, e senza di essa il drawer
   * mostrerebbe `Fase corrente: —` su un dato che invece c'è. Chi lo usa deve continuare a filtrare
   * su `isActive` per le opzioni selezionabili (vedi `usePhaseCatalog`).
   *
   * Distinto da `listAll`, che serve alla gestione del catalogo e richiede il permesso di scrittura.
   *
   * @auth {phase_catalog:read}
   * @input {{ includeInactive?: boolean }} — opzionale, default: solo attive.
   * @output {Phase[]} — sorted by order.
   */
  list: protectedProcedure
    .use(requirePermission('phase_catalog:read'))
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return ctx.prisma.phase.findMany({
        where: input?.includeInactive ? {} : { isActive: true },
        orderBy: { order: 'asc' },
      });
    }),

  /**
   * Lists all phases including inactive ones, for admin management.
   *
   * @auth {phase_catalog:update}
   * @input {none}
   * @output {Phase[]} — all phases sorted by order.
   */
  listAll: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .query(async ({ ctx }) => {
      return ctx.prisma.phase.findMany({
        orderBy: { order: 'asc' },
      });
    }),

  /**
   * Creates a new phase.
   *
   * @auth {phase_catalog:update}
   * @input {PhaseInputSchema} — value (unique), label, optional order. `code` is derived from order, not client-settable.
   * @output {Phase} — the newly created phase.
   */
  create: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(PhaseInputSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.prisma.phase.findUnique({
        where: { value: input.value },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Il valore '${input.value}' esiste già`,
        });
      }

      const maxOrder = await ctx.prisma.phase.aggregate({
        _max: { order: true },
      });
      const order = input.order ?? (maxOrder._max.order ?? -1) + 1;

      const result = await ctx.prisma.phase.create({
        data: {
          value: input.value,
          label: input.label,
          code: codeForOrder(order),
          order,
        },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_CREATE',
        targetType: 'Phase',
        targetId: result.id,
        result: 'SUCCESS',
        metadata: { value: input.value },
      });

      return result;
    }),

  /**
   * Updates mutable fields of a phase (label, order). `code` is re-derived from order automatically.
   *
   * @auth {phase_catalog:update}
   * @input {{ id: string, data: Partial<PhaseInputBaseSchema without value> }}
   * @output {Phase} — the updated phase.
   */
  update: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        id: z.string().uuid(),
        data: partialWithoutDefaults(PhaseInputBaseSchema.omit({ value: true })),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      const order = input.data.order ?? item.order;

      const result = await ctx.prisma.phase.update({
        where: { id: input.id },
        data: { ...input.data, code: codeForOrder(order) },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_UPDATE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: {},
      });

      return result;
    }),

  /**
   * Soft-deletes a phase (isActive=false).
   *
   * Rifiuta finché la fase è ancora in uso, perché disattivarla non è un'operazione neutra per il
   * motore di alert: una fase ritirata smette di essere misurata, quindi le righe ferme lì
   * uscirebbero in silenzio da badge, dashboard e notifiche di ritardo, e le milestone rimaste su
   * quella fase resterebbero nei calendari a spostare quale sia la scadenza attiva. "In uso"
   * significa due cose, entrambe bloccanti:
   *   - righe di collection layout ancora **aperte** (`completedAt` null) su quella fase. Le righe
   *     concluse non contano: hanno già smesso di essere misurate, ed è ciò che rende ritirabile
   *     una fase che andava bene le stagioni scorse senza dover archiviare le stagioni.
   *   - eventi di calendario non cancellati che la referenziano.
   *
   * @auth {phase_catalog:update}
   * @input {{ id: string }} — UUID of the phase to deactivate.
   * @output {{ success: true }}
   * @throws CONFLICT — con conteggi e ripartizione per brand/stagione, così l'admin sa dove agire.
   */
  remove: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      // Letture indipendenti: il conteggio degli eventi non dipende dalle righe trovate.
      // Le righe si contano aggregate per layout invece di caricarle: una fase del catalogo è
      // referenziata da ogni brand × stagione, quindi materializzarle tutte per comporre una
      // stringa significherebbe leggere migliaia di righe a ogni tentativo di ritiro.
      const [rowsPerLayout, plannedEvents] = await Promise.all([
        ctx.prisma.collectionLayoutRow.groupBy({
          by: ['collectionLayoutId'],
          where: { phaseId: input.id, completedAt: null },
          _count: { _all: true },
        }),
        ctx.prisma.calendarEvent.count({ where: { phaseId: input.id, cancelledAt: null } }),
      ]);

      if (rowsPerLayout.length > 0 || plannedEvents > 0) {
        // Solo i layout coinvolti, non tutti: serve a tradurre gli id in codici brand/stagione.
        const layouts = await ctx.prisma.collectionLayout.findMany({
          where: { id: { in: rowsPerLayout.map(r => r.collectionLayoutId) } },
          select: { id: true, brand: { select: { code: true } }, season: { select: { code: true } } },
        });
        const scopeById = new Map(layouts.map(l => [l.id, `${l.brand.code}/${l.season.code}`]));

        throw new TRPCError({
          code: 'CONFLICT',
          message: describePhaseInUse(
            rowsPerLayout.map(r => ({
              scope: scopeById.get(r.collectionLayoutId) ?? r.collectionLayoutId,
              count: r._count._all,
            })),
            plannedEvents
          ),
        });
      }

      await ctx.prisma.phase.update({
        where: { id: input.id },
        data: { isActive: false },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_REMOVE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { value: item.value },
      });

      return { success: true };
    }),

  /**
   * Restores a soft-deleted phase (isActive=true).
   *
   * @auth {phase_catalog:update}
   * @input {{ id: string }} — UUID of the phase to restore.
   * @output {{ success: true }}
   */
  restore: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      await ctx.prisma.phase.update({
        where: { id: input.id },
        data: { isActive: true },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_RESTORE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { value: item.value },
      });

      return { success: true };
    }),

  /**
   * Reorders phases by assigning new position indices.
   *
   * @auth {phase_catalog:update}
   * @input {{ orderedIds: string[] }} — full ordered array of UUIDs.
   * @output {{ success: true }}
   */
  reorder: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.$transaction(
        input.orderedIds.map((id, index) =>
          ctx.prisma.phase.update({
            where: { id },
            data: { order: index, code: codeForOrder(index) },
          })
        )
      );

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_REORDER',
        targetType: 'Phase',
        targetId: 'phase_catalog',
        result: 'SUCCESS',
        metadata: { count: input.orderedIds.length },
      });

      return { success: true };
    }),
});
