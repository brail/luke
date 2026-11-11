import type { Prisma } from '@luke/db';

declare const tx: Prisma.TransactionClient;
declare function insertEventVisibilities(tx: Prisma.TransactionClient, events: { id: string; functionIds: string[] }[]): Promise<void>;

export async function direct(eventId: string, functionId: string, templateItemId: string) {
  // ruleid: luke-function-visibility-writer
  await tx.calendarEventVisibility.createMany({ data: [{ eventId, functionId }] });
  // ruleid: luke-function-visibility-writer
  await tx.milestoneTemplateItemVisibility.create({ data: { templateItemId, functionId } });
  // ruleid: luke-function-visibility-writer
  await tx.calendarEventVisibility.updateMany({ where: { eventId }, data: { functionId } });
}

export async function nested(templateId: string, functionId: string) {
  // ruleid: luke-function-visibility-writer
  await tx.milestoneTemplateItem.create({
    data: { templateId, title: 'Item', offsetDays: 0, visibilities: { createMany: { data: [{ functionId }] } } },
  });
  // ruleid: luke-function-visibility-writer
  await tx.milestoneTemplate.create({
    data: { name: 'T', items: { create: [{ title: 'I', offsetDays: 0, visibilities: { create: [{ functionId }] } }] } },
  });
}

export async function raw(eventId: string, functionId: string) {
  // ruleid: luke-function-visibility-writer
  await tx.$executeRaw`INSERT INTO calendar_event_visibilities ("eventId", "functionId") VALUES (${eventId}, ${functionId})`;
  // ruleid: luke-function-visibility-writer
  await tx.$executeRaw`UPDATE public.milestone_template_item_visibilities SET "functionId" = ${functionId} WHERE "templateItemId" = ${eventId}`;
}

export async function throughTheWriter(eventId: string, functionId: string) {
  // ok: luke-function-visibility-writer
  await insertEventVisibilities(tx, [{ id: eventId, functionIds: [functionId] }]);
  // ok: luke-function-visibility-writer
  await tx.calendarEventVisibility.deleteMany({ where: { eventId } });
  // ok: luke-function-visibility-writer
  await tx.calendarEvent.findMany({ where: { visibilities: { some: { functionId } } }, include: { visibilities: true } });
}
