import { PrismaClient } from '@prisma/client';

// Mapping fedele a PI 8.3-01 rev5 "Progettazione"
const REVISION_TYPE_ITEMS = [
  {
    value: 'REVISIONE_PROGETTUALE',
    label: 'Revisione Progettuale',
    iso9001Categories: ['PIANIFICAZIONE', 'RIESAME'],
    order: 0,
  },
  {
    value: 'REVISIONE_COSTRUTTIVA',
    label: 'Revisione Costruttiva',
    iso9001Categories: ['VERIFICA'],
    order: 1,
  },
  {
    value: 'REVISIONE_MODELLERIA',
    label: 'Revisione Modelleria',
    iso9001Categories: ['VERIFICA'],
    order: 2,
  },
  {
    value: 'REVISIONE_PROTOTIPO',
    label: 'Revisione Prototipo',
    iso9001Categories: ['VERIFICA', 'VALIDAZIONE'],
    order: 3,
  },
  {
    value: 'APPROVAZIONE_CAMPIONARIO',
    label: 'Approvazione Campionario',
    iso9001Categories: ['VALIDAZIONE'],
    order: 4,
  },
  {
    value: 'REVISIONE_FINALE',
    label: 'Revisione Finale',
    iso9001Categories: ['RIESAME', 'NORMALE'],
    order: 5,
  },
] as const;

export async function seedCollectionCatalog(prisma: PrismaClient): Promise<void> {
  for (const item of REVISION_TYPE_ITEMS) {
    await prisma.collectionCatalogItem.upsert({
      where: { type_value: { type: 'revisionType', value: item.value } },
      create: {
        type: 'revisionType',
        value: item.value,
        label: item.label,
        iso9001Categories: [...item.iso9001Categories],
        order: item.order,
        isActive: true,
      },
      update: {
        label: item.label,
        iso9001Categories: [...item.iso9001Categories],
        order: item.order,
      },
    });
  }
}
