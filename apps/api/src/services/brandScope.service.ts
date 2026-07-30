/**
 * Brand scope: chi può toccare quale brand.
 *
 * `requirePermission` risponde a "questo ruolo può leggere i prezzi?". Non
 * risponde a "questo utente può leggere i prezzi **di questo brand**?". Le due
 * domande sono state confuse in più router, e questo modulo è l'unico posto in
 * cui la seconda ha una risposta.
 *
 * ## Perché qui e non altrove
 *
 * Non in `collectionLayout.service.ts`: quel modulo riceve un `prisma` nudo di
 * proposito, perché è invocato con il client di transazione da dentro
 * `$transaction`, e da altri service dove "chi è l'utente" non è in scope. I
 * guard hanno bisogno della sessione.
 *
 * Non in `context.service.ts`: quello risolve brand e stagione correnti, ed è
 * un'altra responsabilità. Continua a ri-esportare `assertBrandAccess` per i
 * router che già la importavano da lì.
 *
 * ## Una sola implementazione
 *
 * Ne esistevano due omonime con firme diverse: `(ctx, brandId)` e
 * `(userId, brandId, prisma, userRole?)`. La seconda aveva `userRole`
 * **opzionale** e tutti e 15 i suoi chiamanti lo omettevano — senza quel
 * parametro `getUserAllowedBrandIds` non prende mai l'early return per gli
 * admin, quindi un admin che non appartiene ad alcun team riceveva `[]` e
 * finiva FORBIDDEN su mezzo calendario stagionale. La toppa era un
 * `hasPermission({ role }, '*:*')` scritto a mano nell'unico punto in cui
 * qualcuno se n'era accorto. Con una firma sola il problema non è più
 * esprimibile.
 */

import { TRPCError } from '@trpc/server';

import { type Role } from '@luke/core';

import { getUserAllowedBrandIds } from './context.service';

import type { PrismaClient } from '@prisma/client';

/**
 * Il minimo che serve a un guard.
 *
 * Strutturale e non `Context` perché le rotte Fastify non-tRPC
 * (`seasonCalendarExport.routes.ts`) hanno prisma e sessione ma non un context
 * tRPC, e devono poter usare gli stessi guard.
 */
export interface BrandScopeCtx {
  prisma: PrismaClient;
  session: { user: { id: string; role: string } } | null;
  /** Vedi `allowedBrandIds`. Presente su `Context`, opzionale altrove. */
  _allowedBrandIdsPromise?: Promise<string[] | null>;
}

/**
 * I brand accessibili all'utente della richiesta, risolti una volta sola.
 *
 * Memoizza la **promise**, non il valore: `seasonCalendar.listEvents` e
 * `copyFromSeason` lanciano più guard in parallelo con `Promise.all`, e con una
 * cache sul valore ognuno partirebbe prima che il primo abbia finito,
 * mancandola tutti. Risultato: una `companyTeamMembership.findMany` per
 * richiesta invece di una per guard, e zero per gli admin.
 *
 * Se la query rigetta, ogni `await` successivo della stessa richiesta eredita il
 * rigetto. È voluto — la richiesta deve fallire, non ritentare.
 */
async function allowedBrandIds(ctx: BrandScopeCtx): Promise<string[] | null> {
  if (!ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }

  // Attenzione a `{ ...ctx, prisma: tx }`: lo spread copia lo slot per valore, e
  // il `??=` scriverebbe sulla copia. Se serve un client di transazione, passalo
  // come parametro esplicito.
  ctx._allowedBrandIdsPromise ??= getUserAllowedBrandIds(
    ctx.session.user.id,
    ctx.prisma,
    ctx.session.user.role as Role
  );

  return ctx._allowedBrandIdsPromise;
}

/**
 * Lancia FORBIDDEN se l'utente non ha accesso al brand.
 *
 * L'accesso è **opt-in stretto**: `null` (nessun vincolo) è riservato agli
 * admin, per tutti gli altri è esattamente l'unione dei `brandScopes` dei team
 * attivi. Nessun team significa nessun brand, non "tutti".
 *
 * @param brandId - Per le risorse identificate da un altro id (un layout, una
 *   riga) passa il `brandId` risolto dal record, mai un campo di input.
 */
export async function assertBrandAccess(
  ctx: BrandScopeCtx,
  brandId: string
): Promise<void> {
  const allowed = await allowedBrandIds(ctx);

  if (allowed !== null && !allowed.includes(brandId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Accesso al brand non consentito',
    });
  }
}

/**
 * Come `assertBrandAccess`, su più brand.
 *
 * Serve alle procedure che copiano fra brand: `collectionLayout.copyFromSeason`
 * e `seasonCalendar.cloneFromBrandSeason` prendono sorgente e destinazione, e
 * **servono entrambi** i controlli. Solo sulla sorgente permette di scrivere in
 * un brand che non è tuo; solo sulla destinazione è esfiltrazione — leggi la
 * collezione di un brand altrui clonandola in uno tuo.
 */
export async function assertBrandAccessAll(
  ctx: BrandScopeCtx,
  brandIds: string[]
): Promise<void> {
  const allowed = await allowedBrandIds(ctx);
  if (allowed === null) return;

  const denied = brandIds.find(id => !allowed.includes(id));
  if (denied !== undefined) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Accesso al brand non consentito',
    });
  }
}

/**
 * Restringe una lista di brand a quelli accessibili. Per gli admin la ritorna
 * intatta.
 *
 * Diversa da `assertBrandAccessAll`: qui un brand non accessibile viene
 * silenziosamente escluso invece di far fallire la richiesta. È il
 * comportamento giusto per una vista filtrabile (il calendario), non per una
 * mutation.
 */
export async function filterAllowedBrandIds(
  ctx: BrandScopeCtx,
  requestedBrandIds: string[]
): Promise<string[]> {
  const allowed = await allowedBrandIds(ctx);
  if (allowed === null) return requestedBrandIds;
  return requestedBrandIds.filter(id => allowed.includes(id));
}

// ─── Resolver per risorsa ─────────────────────────────────────────────────────
//
// Ognuno risolve il `brandId` a partire dall'id della risorsa, verifica
// l'accesso e restituisce il record. Lanciano NOT_FOUND prima di FORBIDDEN: un
// id inesistente non è un problema di permessi.
//
// Catene: layout → `brandId` (0 hop) · gruppo e riga → `collectionLayout.brandId`
// (1 hop, `collectionLayoutId` è denormalizzato sulla riga) · quotazione →
// `row.collectionLayout.brandId` (2 hop).

/** Layout, per `collectionLayoutId`. */
export async function resolveLayoutBrandAccess(
  ctx: BrandScopeCtx,
  collectionLayoutId: string
) {
  const layout = await ctx.prisma.collectionLayout.findUnique({
    where: { id: collectionLayoutId },
    select: { id: true, brandId: true, seasonId: true },
  });
  if (!layout) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout non trovato' });
  }

  await assertBrandAccess(ctx, layout.brandId);
  return layout;
}

/** Gruppo, per `groupId`. */
export async function resolveGroupBrandAccess(
  ctx: BrandScopeCtx,
  groupId: string
) {
  const group = await ctx.prisma.collectionGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      collectionLayoutId: true,
      collectionLayout: { select: { brandId: true } },
    },
  });
  if (!group) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Gruppo non trovato' });
  }

  await assertBrandAccess(ctx, group.collectionLayout.brandId);
  return group;
}

/** Riga, per `rowId`. */
export async function resolveRowBrandAccess(ctx: BrandScopeCtx, rowId: string) {
  const row = await ctx.prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
    select: {
      id: true,
      collectionLayoutId: true,
      groupId: true,
      collectionLayout: { select: { brandId: true } },
    },
  });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
  }

  await assertBrandAccess(ctx, row.collectionLayout.brandId);
  return row;
}

/** Quotazione, per `quotationId`. */
export async function resolveQuotationBrandAccess(
  ctx: BrandScopeCtx,
  quotationId: string
) {
  const quotation = await ctx.prisma.collectionRowQuotation.findUnique({
    where: { id: quotationId },
    select: {
      id: true,
      rowId: true,
      row: { select: { collectionLayout: { select: { brandId: true } } } },
    },
  });
  if (!quotation) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Quotazione non trovata',
    });
  }

  await assertBrandAccess(ctx, quotation.row.collectionLayout.brandId);
  return quotation;
}

/**
 * Righe multiple, per `rowIds`. Pretende che appartengano tutte allo stesso
 * layout — è il presupposto di `bulkAssignRowsPlanningGroup`, che lo documenta
 * ma non lo verificava.
 *
 * @returns L'id del layout comune.
 */
export async function resolveRowsBrandAccess(
  ctx: BrandScopeCtx,
  rowIds: string[]
): Promise<string> {
  const rows = await ctx.prisma.collectionLayoutRow.findMany({
    where: { id: { in: rowIds } },
    select: {
      collectionLayoutId: true,
      collectionLayout: { select: { brandId: true } },
    },
  });

  if (rows.length !== rowIds.length) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Una o più righe non trovate',
    });
  }

  const layoutIds = new Set(rows.map(r => r.collectionLayoutId));
  if (layoutIds.size !== 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Le righe devono appartenere allo stesso layout',
    });
  }

  await assertBrandAccess(ctx, rows[0].collectionLayout.brandId);
  return rows[0].collectionLayoutId;
}

/** Revisione, per `revisionId`. */
export async function resolveRevisionBrandAccess(
  ctx: BrandScopeCtx,
  revisionId: string
) {
  const revision = await ctx.prisma.collectionLayoutRevision.findUnique({
    where: { id: revisionId },
    select: {
      id: true,
      collectionLayoutId: true,
      collectionLayout: { select: { brandId: true } },
    },
  });
  if (!revision) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Revisione non trovata' });
  }

  await assertBrandAccess(ctx, revision.collectionLayout.brandId);
  return revision;
}

/**
 * Riga di piano merchandising, per `rowId`.
 *
 * Catena distinta da quella del collection layout: `MerchandisingPlanRow.planId`
 * → `MerchandisingPlan.brandId`. Gli id sono uuid indistinguibili a occhio, e i
 * due `rowId` vivono in router diversi.
 */
export async function resolveMerchPlanRowBrandAccess(
  ctx: BrandScopeCtx,
  rowId: string
) {
  const row = await ctx.prisma.merchandisingPlanRow.findUnique({
    where: { id: rowId },
    select: { id: true, planId: true, plan: { select: { brandId: true } } },
  });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
  }

  await assertBrandAccess(ctx, row.plan.brandId);
  return row;
}

/** Planning group, per `planningGroupId`. */
export async function resolvePlanningGroupBrandAccess(
  ctx: BrandScopeCtx,
  planningGroupId: string
) {
  const group = await ctx.prisma.planningGroup.findUnique({
    where: { id: planningGroupId },
    select: {
      calendarId: true,
      anchorDate: true,
      calendar: { select: { brandId: true, seasonId: true } },
    },
  });
  if (!group) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Gruppo di pianificazione non trovato',
    });
  }

  await assertBrandAccess(ctx, group.calendar.brandId);
  return group;
}
