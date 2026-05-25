import { PrismaClient } from '@prisma/client';

const EVENT_TYPE_ITEMS = [
  { value: 'KICKOFF',   label: 'Kickoff',   color: 'green',  order: 0 },
  { value: 'REVIEW',    label: 'Review',    color: 'blue',   order: 1 },
  { value: 'GATE',      label: 'Gate',      color: 'orange', order: 2 },
  { value: 'DEADLINE',  label: 'Deadline',  color: 'red',    order: 3 },
  { value: 'MILESTONE', label: 'Milestone', color: 'purple', order: 4 },
  { value: 'CUSTOM',    label: 'Custom',    color: null,     order: 5 },
];

export async function seedCalendarCatalog(prisma: PrismaClient): Promise<void> {
  console.log('📅 Seeding calendar catalog (event types)...');

  for (const item of EVENT_TYPE_ITEMS) {
    await prisma.calendarCatalogItem.upsert({
      where: { type_value: { type: 'eventType', value: item.value } },
      update: { label: item.label, color: item.color, order: item.order },
      create: {
        type: 'eventType',
        value: item.value,
        label: item.label,
        color: item.color,
        order: item.order,
        isActive: true,
      },
    });
  }

  console.log(`   ${EVENT_TYPE_ITEMS.length} event types seeded`);
}
