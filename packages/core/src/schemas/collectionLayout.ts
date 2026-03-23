import { z } from 'zod';

// Columns that can be toggled on/off. Always-visible: #, line, skuForecast, actions
// Max 7 visible at a time.
export const COLLECTION_TABLE_COLUMNS = [
  { key: 'foto',            label: 'Foto' },
  { key: 'supplier',        label: 'Fornitore' },
  { key: 'productCategory', label: 'Categoria' },
  { key: 'strategy',        label: 'Strategy' },
  { key: 'status',          label: 'Status' },
  { key: 'progress',        label: 'Progress' },
  { key: 'qtyForecast',     label: 'Qty' },
  { key: 'gender',          label: 'Gender' },
  { key: 'designer',        label: 'Designer' },
  { key: 'styleStatus',     label: 'Style Status' },
] as const;

export const COLLECTION_COLUMNS_MAX_VISIBLE = 7;

// Columns hidden by default (when no user preference is saved)
export const COLLECTION_COLUMNS_DEFAULT_HIDDEN = [
  'gender',
  'designer',
  'styleStatus',
] as const;

export const COLLECTION_GENDER = ['MAN', 'WOMAN'] as const;
export type CollectionGender = (typeof COLLECTION_GENDER)[number];

export const COLLECTION_STRATEGY = ['CORE', 'INNOVATION'] as const;
export type CollectionStrategy = (typeof COLLECTION_STRATEGY)[number];

export const COLLECTION_STATUS = ['CARRY_OVER', 'NEW'] as const;
export type CollectionStatus = (typeof COLLECTION_STATUS)[number];

export const COLLECTION_PROGRESS = [
  '01 - FASE DI DESIGN',
  '02 - COSTRUZIONE OK',
  '03 - MODELLERIA OK',
  '04 - RENDERING FATTI',
  '05 - SPEC SHEETS PRONTE',
  '06 - SMS LANCIATI',
] as const;
export type CollectionProgress = (typeof COLLECTION_PROGRESS)[number];

export const CollectionGroupInputSchema = z.object({
  name: z.string().min(1, 'Nome obbligatorio').max(100),
  order: z.number().int().optional(),
  skuBudget: z.number().int().min(0).optional().nullable(),
});

export const CollectionLayoutSettingsSchema = z.object({
  skuBudget: z.number().int().min(0).optional().nullable(),
  hiddenColumns: z.array(z.string()).optional().nullable(),
});
export type CollectionGroupInput = z.infer<typeof CollectionGroupInputSchema>;

export const CollectionLayoutRowInputSchema = z.object({
  groupId: z.string().min(1),
  order: z.number().int().optional(),
  // Required
  gender: z.enum(COLLECTION_GENDER),
  navVendorId: z.string().min(1).nullable(),
  line: z.string().min(1, 'Linea obbligatoria'),
  status: z.enum(COLLECTION_STATUS),
  skuForecast: z.number().int().min(0, 'SKU Forecast non può essere negativo'),
  qtyForecast: z.number().int().min(0, 'Qty Forecast non può essere negativo'),
  productCategory: z.string().min(1, 'Categoria prodotto obbligatoria'),
  // Optional — identification/progress
  strategy: z.enum(COLLECTION_STRATEGY).optional().nullable(),
  styleStatus: z.enum(COLLECTION_STATUS).optional().nullable(),
  progress: z.enum(COLLECTION_PROGRESS).optional().nullable(),
  designer: z.string().optional().nullable(),
  pictureUrl: z.string().optional().nullable(),
  // Optional — notes
  styleNotes: z.string().optional().nullable(),
  materialNotes: z.string().optional().nullable(),
  colorNotes: z.string().optional().nullable(),
  priceNotes: z.string().optional().nullable(),
  toolingNotes: z.string().optional().nullable(),
  // Optional — pricing
  pricingParameterSetId: z.string().optional().nullable(),
  retailTargetPrice: z.number().positive().optional().nullable(),
  buyingTargetPrice: z.number().positive().optional().nullable(),
  supplierFirstQuotation: z.number().positive().optional().nullable(),
  toolingQuotation: z.number().positive().optional().nullable(),
});
export type CollectionLayoutRowInput = z.infer<
  typeof CollectionLayoutRowInputSchema
>;
