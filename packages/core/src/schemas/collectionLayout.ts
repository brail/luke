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
  { key: 'gender',            label: 'Gender' },
  { key: 'designer',          label: 'Designer' },
  { key: 'styleStatus',       label: 'Style Status' },
  { key: 'pricePositioning',  label: 'Posizionamento' },
] as const;

export const COLLECTION_COLUMNS_MAX_VISIBLE = 7;

// Columns hidden by default (when no user preference is saved)
export const COLLECTION_COLUMNS_DEFAULT_HIDDEN = [
  'article',
  'gender',
  'designer',
  'styleStatus',
  'margin',
  'pricePositioning',
] as const;

export const COLLECTION_GENDER = ['MAN', 'WOMAN'] as const;
export type CollectionGender = (typeof COLLECTION_GENDER)[number];

// Default catalog values — used for seeding CollectionCatalogItem on migration
export const DEFAULT_CATALOG_STRATEGY = ['CORE', 'INNOVATION'] as const;
export const DEFAULT_CATALOG_LINE_STATUS = ['CARRY_OVER', 'NEW'] as const;
export const DEFAULT_CATALOG_STYLE_STATUS = ['CARRY_OVER', 'NEW'] as const;
export const DEFAULT_CATALOG_PROGRESS = [
  'DESIGN',
  'CONSTRUCTION_OK',
  'MODELLERIA_OK',
  'RENDERING',
  'SPECSHEETS_READY',
  'SMS_LAUNCHED',
] as const;

// Kept for backward compat (export + xlsx/pdf services still reference these)
export const COLLECTION_STRATEGY = DEFAULT_CATALOG_STRATEGY;
export type CollectionStrategy = (typeof COLLECTION_STRATEGY)[number];
export const COLLECTION_STATUS = DEFAULT_CATALOG_LINE_STATUS;
export type CollectionStatus = (typeof COLLECTION_STATUS)[number];
export const COLLECTION_PROGRESS = DEFAULT_CATALOG_PROGRESS;
export type CollectionProgress = (typeof COLLECTION_PROGRESS)[number];

export const DEFAULT_CATALOG_PRICE_POSITIONING = ['ENTRY', 'MID_MARKET', 'PREMIUM', 'LUXURY'] as const;

export const COLLECTION_CATALOG_TYPES = [
  'strategy',
  'lineStatus',
  'styleStatus',
  'progress',
  'revisionType',
  'pricePositioning',
] as const;
export type CollectionCatalogType = (typeof COLLECTION_CATALOG_TYPES)[number];

// ISO 9001:2015 categories — from Tabella correlazione §4.2 PI 8.3-01 rev5
export const ISO9001_CATEGORIES = [
  'PIANIFICAZIONE',
  'RIESAME',
  'NORMALE',
  'VERIFICA',
  'VALIDAZIONE',
] as const;
export type Iso9001Category = (typeof ISO9001_CATEGORIES)[number];

export const REVISION_CAUSES = ['MANUAL', 'MILESTONE'] as const;
export type RevisionCause = (typeof REVISION_CAUSES)[number];

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
  skuForecast: z.number().int().min(1, 'SKU Forecast deve essere almeno 1').nullable(),
  qtyForecast: z.number().int().min(1, 'Qty Forecast deve essere almeno 1'),
  productCategory: z.string().min(1, 'Categoria prodotto obbligatoria'),
  // Optional — identification/progress
  strategy: z.string().optional().nullable(),
  styleStatus: z.string().optional().nullable(),
  progress: z.string().optional().nullable(),
  pricePositioning: z.string().optional().nullable(),
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

export const CollectionCatalogItemInputBaseSchema = z.object({
  type: z.enum(COLLECTION_CATALOG_TYPES),
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  order: z.number().int().min(0).optional(),
  code: z.string().max(10).optional().nullable(),
  iso9001Categories: z.array(z.enum(ISO9001_CATEGORIES)).optional().nullable(),
  expectedMinProgress: z.string().optional().nullable(),
});

export const CollectionCatalogItemInputSchema =
  CollectionCatalogItemInputBaseSchema.refine(
    data => data.type !== 'revisionType' || (data.iso9001Categories && data.iso9001Categories.length > 0),
    { message: 'iso9001Categories obbligatorio per type=revisionType', path: ['iso9001Categories'] }
  ).refine(
    data => !data.code || data.type === 'progress',
    { message: 'code è atteso solo per type=progress', path: ['code'] }
  );
export type CollectionCatalogItemInput = z.infer<
  typeof CollectionCatalogItemInputSchema
>;

// ─── Revision schemas ─────────────────────────────────────────────────────────

export const CreateRevisionInputSchema = z.object({
  collectionLayoutId: z.string().uuid(),
  revisionTypeValue: z.string().min(1),
  cause: z.enum(REVISION_CAUSES).default('MANUAL'),
  milestoneId: z.string().uuid().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  includedRowIds: z.array(z.string().uuid()).min(0),
}).refine(
  data => data.cause !== 'MILESTONE' || !!data.milestoneId,
  { message: 'milestoneId richiesto se cause=MILESTONE', path: ['milestoneId'] }
).refine(
  data => data.cause !== 'MANUAL' || !data.milestoneId,
  { message: 'milestoneId non ammesso se cause=MANUAL', path: ['milestoneId'] }
);
export type CreateRevisionInput = z.infer<typeof CreateRevisionInputSchema>;

export const GetRevisionsListInputSchema = z.object({
  collectionLayoutId: z.string().uuid(),
});
export type GetRevisionsListInput = z.infer<typeof GetRevisionsListInputSchema>;

export const GetRevisionDetailInputSchema = z.object({
  revisionId: z.string().uuid(),
});
export type GetRevisionDetailInput = z.infer<typeof GetRevisionDetailInputSchema>;

export const GetLayoutAsOfRevisionInputSchema = z.object({
  collectionLayoutId: z.string().uuid(),
  revisionId: z.string().uuid(),
});
export type GetLayoutAsOfRevisionInput = z.infer<typeof GetLayoutAsOfRevisionInputSchema>;
