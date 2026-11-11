/**
 * The only writer of a company function's visibility rows on calendar events and template items
 * (#241). An inactive function gets no new association to an active event or to a template item
 * (#237): every write here locks the functions it names and refuses an inactive one in the same
 * transaction as the insert. Semgrep (`luke-function-visibility-writer`) refuses an insert into
 * either table anywhere else in the API.
 *
 * `function.delete` locks the function row `FOR NO KEY UPDATE` before it counts both tables, so
 * either it sees the rows a writer here commits, or the writer sees the function inactive.
 *
 * The database holds the same rule as a backstop (#242): the triggers of migration
 * `20261111120000_company_function_active_triggers` refuse what these checks refuse, for any writer.
 * Here the checks answer first; a trigger refusal still reads PRECONDITION_FAILED.
 */

import { TRPCError } from '@trpc/server';

import { Prisma } from '@luke/db';

import { refuseOnInactiveFunction } from '../lib/error.js';

/** A trigger refusal that the checks here did not answer first. */
const INACTIVE = 'Una funzione scelta è disattivata. Ricarica e riprova.';

/** An event's (or a template item's) functions, and its name for a refusal naming several. */
export interface FunctionCarrier {
  id: string;
  functionIds: readonly string[];
  name?: string;
}

/**
 * Locks the named functions `FOR SHARE` until commit and refuses an inactive one, naming its
 * carriers. Once per transaction, all ids in one `ORDER BY id` batch, so writers, `function.delete`
 * and `function.reorder` cannot deadlock. Raw SQL exception: a row lock the ORM cannot express.
 */
async function lockActiveFunctions(tx: Prisma.TransactionClient, carriers: readonly FunctionCarrier[]): Promise<void> {
  const namesByFunction = new Map<string, Set<string>>();
  for (const { functionIds, name } of carriers) {
    for (const id of functionIds) {
      let names = namesByFunction.get(id);
      if (!names) namesByFunction.set(id, names = new Set());
      if (name) names.add(name);
    }
  }
  if (namesByFunction.size === 0) return;
  const rows = await tx.$queryRaw<{ id: string; name: string; isActive: boolean }[]>(Prisma.sql`
    SELECT id, name, "isActive" FROM company_functions WHERE id = ANY(${[...namesByFunction.keys()]}::text[]) ORDER BY id FOR SHARE`);
  // A missing function would otherwise fail the insert's foreign key as a 500 (CLAUDE.md rule 3).
  if (rows.length < namesByFunction.size) throw new TRPCError({ code: 'NOT_FOUND', message: 'Funzione non trovata.' });
  const inactive = rows.filter(f => !f.isActive);
  if (inactive.length === 0) return;
  const named = inactive.map(f => {
    const where = [...(namesByFunction.get(f.id) ?? [])];
    return where.length ? `«${f.name}» (in ${where.join(', ')})` : `«${f.name}»`;
  });
  const [noun, fix] = inactive.length === 1
    ? ['Funzione disattivata', 'Toglila dalla visibilità o ripristinala']
    : ['Funzioni disattivate', 'Toglile dalla visibilità o ripristinale'];
  throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `${noun}: ${named.join(', ')}. ${fix} prima di salvare.` });
}

/**
 * Inserts the visibility rows of new events. A write of many events (template apply, clone) passes
 * them all, named, in one call, and is refused whole.
 */
export async function insertEventVisibilities(tx: Prisma.TransactionClient, events: readonly FunctionCarrier[]): Promise<void> {
  await lockActiveFunctions(tx, events);
  await refuseOnInactiveFunction(INACTIVE, () => tx.calendarEventVisibility.createMany({
    data: events.flatMap(e => e.functionIds.map(functionId => ({ eventId: e.id, functionId }))),
  }));
}

/**
 * Replaces an existing event's functions, writing only the change. Only an added function must be
 * active: one the event had before #237 may stay. The caller holds the event row.
 *
 * @returns The functions the event had before.
 */
export async function replaceEventVisibilities(
  tx: Prisma.TransactionClient,
  eventId: string,
  functionIds: readonly string[]
): Promise<string[]> {
  const before = (await tx.calendarEventVisibility.findMany({ where: { eventId }, select: { functionId: true } })).map(v => v.functionId);
  const added = [...new Set(functionIds)].filter(id => !before.includes(id));
  await lockActiveFunctions(tx, [{ id: eventId, functionIds: added }]);
  await tx.calendarEventVisibility.deleteMany({ where: { eventId, functionId: { notIn: [...functionIds] } } });
  await refuseOnInactiveFunction(INACTIVE, () => tx.calendarEventVisibility.createMany({ data: added.map(functionId => ({ eventId, functionId })) }));
  return before;
}

/** Inserts a template item's visibility rows, after refusing an inactive function among them. */
export async function insertTemplateItemVisibilities(
  tx: Prisma.TransactionClient,
  templateItemId: string,
  functionIds: readonly string[]
) {
  await lockActiveFunctions(tx, [{ id: templateItemId, functionIds }]);
  return refuseOnInactiveFunction(INACTIVE, () => tx.milestoneTemplateItemVisibility.createManyAndReturn({
    data: functionIds.map(functionId => ({ templateItemId, functionId })),
  }));
}

/**
 * Replaces a template item's functions. Every function it keeps must be active too: an item that
 * carries an inactive one is refused on any save (#237). The caller holds the item row.
 */
export async function replaceTemplateItemVisibilities(
  tx: Prisma.TransactionClient,
  templateItemId: string,
  functionIds: readonly string[]
): Promise<void> {
  await lockActiveFunctions(tx, [{ id: templateItemId, functionIds }]);
  await tx.milestoneTemplateItemVisibility.deleteMany({ where: { templateItemId } });
  await refuseOnInactiveFunction(INACTIVE, () =>
    tx.milestoneTemplateItemVisibility.createMany({ data: functionIds.map(functionId => ({ templateItemId, functionId })) }));
}

/** Refuses reactivating an event visible to an inactive function; the caller holds the event row. */
export async function assertEventFunctionsActive(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const rows = await tx.calendarEventVisibility.findMany({ where: { eventId }, select: { functionId: true } });
  await lockActiveFunctions(tx, [{ id: eventId, functionIds: rows.map(r => r.functionId) }]);
}

/** Refuses saving a template item that carries an inactive function; the caller holds the item row. */
export async function assertTemplateItemFunctionsActive(tx: Prisma.TransactionClient, templateItemId: string): Promise<void> {
  const rows = await tx.milestoneTemplateItemVisibility.findMany({ where: { templateItemId }, select: { functionId: true } });
  await lockActiveFunctions(tx, [{ id: templateItemId, functionIds: rows.map(r => r.functionId) }]);
}
