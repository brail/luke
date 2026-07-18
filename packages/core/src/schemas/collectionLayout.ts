import { z } from 'zod';

/**
 * Toggleable columns for the collection table. Always-visible columns (#, line, skuForecast, actions)
 * are not listed here. At most `COLLECTION_COLUMNS_MAX_VISIBLE` of these may be shown simultaneously.
 */
export const COLLECTION_TABLE_COLUMNS = [
  { key: 'foto',            label: 'Foto' },
  { key: 'article',         label: 'Articolo' },
  { key: 'supplier',        label: 'Fornitore' },
  { key: 'productCategory', label: 'Categoria' },
  { key: 'strategy',        label: 'Strategy' },
  { key: 'status',          label: 'Status' },
  { key: 'progress',        label: 'Fase' }, // key kept for saved column-visibility prefs; maps to phaseId
  { key: 'qtyForecast',     label: 'Qty' },
  { key: 'margin',          label: 'Margine' },
  { key: 'gender',            label: 'Gender' },
  { key: 'designer',          label: 'Designer' },
  { key: 'styleStatus',       label: 'Style Status' },
  { key: 'pricePositioning',  label: 'Posizionamento' },
] as const;

/** Maximum number of toggleable columns that can be visible simultaneously. */
export const COLLECTION_COLUMNS_MAX_VISIBLE = 7;

/** Columns hidden by default when no user preference has been saved. */
export const COLLECTION_COLUMNS_DEFAULT_HIDDEN = [
  'article',
  'gender',
  'designer',
  'styleStatus',
  'margin',
  'pricePositioning',
] as const;

/** Allowed gender values for collection rows. Used in collection layout forms and filtering. */
export const COLLECTION_GENDER = ['MAN', 'WOMAN'] as const;
export type CollectionGender = (typeof COLLECTION_GENDER)[number];

/** Default strategy catalog values — used to seed `CollectionCatalogItem` on migration. */
export const DEFAULT_CATALOG_STRATEGY = ['CORE', 'INNOVATION'] as const;
/** Default line-status catalog values. */
export const DEFAULT_CATALOG_LINE_STATUS = ['CARRY_OVER', 'NEW'] as const;
/** Default style-status catalog values. */
export const DEFAULT_CATALOG_STYLE_STATUS = ['CARRY_OVER', 'NEW'] as const;
// Kept for backward compatibility — export and xlsx/pdf services still reference these aliases.
export const COLLECTION_STRATEGY = DEFAULT_CATALOG_STRATEGY;
export type CollectionStrategy = (typeof COLLECTION_STRATEGY)[number];
export const COLLECTION_STATUS = DEFAULT_CATALOG_LINE_STATUS;
export type CollectionStatus = (typeof COLLECTION_STATUS)[number];

/** Default price-positioning catalog values. */
export const DEFAULT_CATALOG_PRICE_POSITIONING = ['ENTRY', 'MID_MARKET', 'PREMIUM', 'LUXURY'] as const;

/** All catalog dimension types managed via the `CollectionCatalogItem` table. */
export const COLLECTION_CATALOG_TYPES = [
  'strategy',
  'lineStatus',
  'styleStatus',
  'revisionType',
  'pricePositioning',
] as const;
export type CollectionCatalogType = (typeof COLLECTION_CATALOG_TYPES)[number];

/** ISO 9001:2015 review categories — from Tabella correlazione §4.2 PI 8.3-01 rev5. Used on revision-type catalog items. */
export const ISO9001_CATEGORIES = [
  'PIANIFICAZIONE',
  'RIESAME',
  'NORMALE',
  'VERIFICA',
  'VALIDAZIONE',
] as const;
export type Iso9001Category = (typeof ISO9001_CATEGORIES)[number];

/** Allowed causes for a collection layout revision. `MILESTONE` requires a linked `milestoneId`. */
export const REVISION_CAUSES = ['MANUAL', 'MILESTONE'] as const;
export type RevisionCause = (typeof REVISION_CAUSES)[number];

/** Input schema for creating or updating a collection group. `skuBudget` belongs to the group, not to individual rows. */
export const CollectionGroupInputSchema = z.object({
  name: z.string().min(1, 'Nome obbligatorio').max(100),
  order: z.number().int().optional(),
  skuBudget: z.number().int().min(0).optional().nullable(),
});
export type CollectionGroupInput = z.infer<typeof CollectionGroupInputSchema>;

/** Layout-level settings persisted alongside the collection layout (column visibility, SKU budget, available genders). */
export const CollectionLayoutSettingsSchema = z.object({
  skuBudget: z.number().int().min(0).optional().nullable(),
  hiddenColumns: z.array(z.string()).optional().nullable(),
  availableGenders: z.array(z.string()).min(1).optional(),
});

/**
 * Input schema for a single collection layout row.
 * `skuForecast` belongs to the row; `skuBudget` belongs to the parent group.
 */
export const CollectionLayoutRowInputSchema = z.object({
  groupId: z.string().min(1),
  // FK to PlanningGroup. Omitted on create → backend resolves the season's default planning group.
  planningGroupId: z.string().uuid().optional(),
  order: z.number().int().optional(),
  // Required
  gender: z.string().min(1, 'Gender obbligatorio'),
  vendorId: z.string().uuid().nullable().optional(),
  line: z.string().min(1, 'Linea obbligatoria'),
  article: z.string().max(100).optional().nullable(),
  status: z.string().min(1, 'Status obbligatorio'),
  skuForecast: z.number().int().min(1, 'SKU Forecast deve essere almeno 1').nullable(),
  qtyForecast: z.number().int().min(1, 'Qty Forecast deve essere almeno 1').nullable(),
  productCategory: z.string().min(1, 'Categoria prodotto obbligatoria'),
  // Optional — identification/progress
  strategy: z.string().optional().nullable(),
  styleStatus: z.string().optional().nullable(),
  phaseId: z.string().uuid().optional().nullable(),
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

/** Input schema for bulk-assigning a set of collection layout rows to a planning group. */
export const CollectionLayoutBulkAssignPlanningGroupInputSchema = z.object({
  rowIds: z.array(z.string().uuid()).min(1).max(100),
  planningGroupId: z.string().uuid(),
});
export type CollectionLayoutBulkAssignPlanningGroupInput = z.infer<
  typeof CollectionLayoutBulkAssignPlanningGroupInputSchema
>;

/** Input schema for creating or updating a quotation attached to a collection row. */
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

/** Base fields for a catalog item before refinement constraints are applied. */
export const CollectionCatalogItemInputBaseSchema = z.object({
  type: z.enum(COLLECTION_CATALOG_TYPES),
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  order: z.number().int().min(0).optional(),
  iso9001Categories: z.array(z.enum(ISO9001_CATEGORIES)).optional().nullable(),
  expectedMinPhaseId: z.string().uuid().optional().nullable(),
});

/**
 * Full input schema for a catalog item with cross-field constraint:
 * `revisionType` items require at least one `iso9001Categories` entry.
 */
export const CollectionCatalogItemInputSchema =
  CollectionCatalogItemInputBaseSchema.refine(
    data => data.type !== 'revisionType' || (data.iso9001Categories && data.iso9001Categories.length > 0),
    { message: 'iso9001Categories obbligatorio per type=revisionType', path: ['iso9001Categories'] }
  );
export type CollectionCatalogItemInput = z.infer<
  typeof CollectionCatalogItemInputSchema
>;

// ─── Revision schemas ─────────────────────────────────────────────────────────

/** Input schema for creating a new collection layout revision snapshot. */
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
