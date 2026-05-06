import { z } from 'zod';

// Columns that can be toggled on/off. Always-visible: #, line, skuForecast, actions
// Max 7 visible at a time.
export const COLLECTION_TABLE_COLUMNS = [
  { key: 'foto',            label: 'Foto' },
  { key: 'article',         label: 'Articolo' },
  { key: 'supplier',        label: 'Fornitore' },
  { key: 'productCategory', label: 'Categoria' },
  { key: 'strategy',        label: 'Strategy' },
  { key: 'status',          label: 'Status' },
  { key: 'progress',        label: 'Progress' },
  { key: 'qtyForecast',     label: 'Qty' },
  { key: 'margin',          label: 'Margine' },
  { key: 'gender',          label: 'Gender' },
  { key: 'designer',        label: 'Designer' },
  { key: 'styleStatus',     label: 'Style Status' },
] as const;

export const COLLECTION_COLUMNS_MAX_VISIBLE = 7;

// Columns hidden by default (when no user preference is saved)
export const COLLECTION_COLUMNS_DEFAULT_HIDDEN = [
  'article',
  'gender',
  'designer',
  'styleStatus',
  'margin',
] as const;

export const COLLECTION_GENDER = ['MAN', 'WOMAN'] as const;
export type CollectionGender = (typeof COLLECTION_GENDER)[number];

// Default catalog values — used for seeding CollectionCatalogItem on migration
export const DEFAULT_CATALOG_STRATEGY = ['CORE', 'INNOVATION'] as const;
export const DEFAULT_CATALOG_LINE_STATUS = ['CARRY_OVER', 'NEW'] as const;
export const DEFAULT_CATALOG_STYLE_STATUS = ['CARRY_OVER', 'NEW'] as const;
export const DEFAULT_CATALOG_PROGRESS = [
  '01 - FASE DI DESIGN',
  '02 - COSTRUZIONE OK',
  '03 - MODELLERIA OK',
  '04 - RENDERING FATTI',
  '05 - SPEC SHEETS PRONTE',
  '06 - SMS LANCIATI',
] as const;

// Kept for backward compat (export + xlsx/pdf services still reference these)
export const COLLECTION_STRATEGY = DEFAULT_CATALOG_STRATEGY;
export type CollectionStrategy = (typeof COLLECTION_STRATEGY)[number];
export const COLLECTION_STATUS = DEFAULT_CATALOG_LINE_STATUS;
export type CollectionStatus = (typeof COLLECTION_STATUS)[number];
export const COLLECTION_PROGRESS = DEFAULT_CATALOG_PROGRESS;
export type CollectionProgress = (typeof COLLECTION_PROGRESS)[number];

export const COLLECTION_CATALOG_TYPES = [
  'strategy',
  'lineStatus',
  'styleStatus',
  'progress',
] as const;
export type CollectionCatalogType = (typeof COLLECTION_CATALOG_TYPES)[number];

export const CollectionGroupInputSchema = z.object({
  name: z.string().min(1, 'Nome obbligatorio').max(100),
  order: z.number().int().optional(),
  skuBudget: z.number().int().min(0).optional().nullable(),
});
export type CollectionGroupInput = z.infer<typeof CollectionGroupInputSchema>;

export const CollectionLayoutSettingsSchema = z.object({
  skuBudget: z.number().int().min(0).optional().nullable(),
  hiddenColumns: z.array(z.string()).optional().nullable(),
  availableGenders: z.array(z.string()).min(1).optional(),
});

export const CollectionLayoutRowInputSchema = z.object({
  groupId: z.string().min(1),
  order: z.number().int().optional(),
  // Required
  gender: z.string().min(1, 'Gender obbligatorio'),
  vendorId: z.string().uuid().nullable().optional(),
  line: z.string().min(1, 'Linea obbligatoria'),
  article: z.string().max(100).optional().nullable(),
  status: z.string().min(1, 'Status obbligatorio'),
  skuForecast: z.number().int().min(1, 'SKU Forecast deve essere almeno 1'),
  qtyForecast: z.number().int().min(1, 'Qty Forecast deve essere almeno 1'),
  productCategory: z.string().min(1, 'Categoria prodotto obbligatoria'),
  // Optional — identification/progress
  strategy: z.string().optional().nullable(),
  styleStatus: z.string().optional().nullable(),
  progress: z.string().optional().nullable(),
  designer: z.string().optional().nullable(),
  pictureKey: z.string().optional().nullable(),
  pendingPictureFileObjectId: z.string().uuid().optional().nullable(),
  // Optional — notes
  styleNotes: z.string().optional().nullable(),
  materialNotes: z.string().optional().nullable(),
  colorNotes: z.string().optional().nullable(),
  toolingNotes: z.string().optional().nullable(),
  // Optional — pricing
  toolingQuotation: z.number().positive().optional().nullable(),
});
export type CollectionLayoutRowInput = z.infer<
  typeof CollectionLayoutRowInputSchema
>;

export const CollectionRowQuotationInputSchema = z.object({
  rowId: z.string().uuid(),
  order: z.number().int().optional(),
  pricingParameterSetId: z.string().optional().nullable(),
  retailPrice: z.number().positive().optional().nullable(),
  supplierQuotation: z.number().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  sku: z.number().int().min(1).optional().nullable(),
});
export type CollectionRowQuotationInput = z.infer<
  typeof CollectionRowQuotationInputSchema
>;

export const CollectionRowQuotationUpdateSchema =
  CollectionRowQuotationInputSchema.omit({ rowId: true }).partial();
export type CollectionRowQuotationUpdate = z.infer<
  typeof CollectionRowQuotationUpdateSchema
>;

export const CollectionCatalogItemInputSchema = z.object({
  type: z.enum(COLLECTION_CATALOG_TYPES),
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  order: z.number().int().min(0).optional(),
});
export type CollectionCatalogItemInput = z.infer<
  typeof CollectionCatalogItemInputSchema
>;
