import { PrismaClient } from '@prisma/client';

const EVENT_TYPE_ITEMS = [
  { value: 'KICKOFF',  label: 'Kickoff',  order: 0 },
  { value: 'REVIEW',   label: 'Review',   order: 1 },
  { value: 'GATE',     label: 'Gate',     order: 2 },
  { value: 'DEADLINE', label: 'Deadline', order: 3 },
  { value: 'CUSTOM',   label: 'Custom',   order: 4 },
];

export async function seedCalendarCatalog(prisma: PrismaClient): Promise<void> {
  console.log('📅 Seeding calendar catalog (event types)...');

  for (const item of EVENT_TYPE_ITEMS) {
    await prisma.calendarCatalogItem.upsert({
      where: { type_value: { type: 'eventType', value: item.value } },
      update: { label: item.label, order: item.order },
      create: {
        type: 'eventType',
        value: item.value,
        label: item.label,
        order: item.order,
        isActive: true,
      },
    });
  }

  console.log(`   ${EVENT_TYPE_ITEMS.length} event types seeded`);
}
