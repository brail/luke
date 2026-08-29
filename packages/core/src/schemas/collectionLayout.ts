import { z } from 'zod';

import { partialWithoutDefaults } from '../utils/zod';

import { MandatoryReasonSchema } from './reason';

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
  // Optional — sotto-flussi bufferizzati nel drawer, committati atomicamente col salvataggio riga
  quotations: z.array(z.lazy(() => CollectionRowQuotationDraftSchema)).optional(),
  // Transiente, mai persistito su colonna — solo per arricchire l'audit log quando phaseId cambia davvero
  phaseChangeNote: z.string().max(500).optional().nullable(),
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

/**
 * Input schema for concluding or reopening the development of a collection row: `note` is mandatory
 * in both directions, `force` acknowledges phases the row skipped. Shared with `RowCompletionDialog`
 * so the form and the endpoint reject the same text with the same message; the reasoning is on
 * `rows.setCompleted`.
 */
export const CollectionRowSetCompletedInputSchema = z.object({
  rowId: z.string(),
  completed: z.boolean(),
  note: MandatoryReasonSchema,
  force: z.boolean().optional(),
});
export type CollectionRowSetCompletedInput = z.infer<
  typeof CollectionRowSetCompletedInputSchema
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

export const CollectionRowQuotationUpdateSchema = partialWithoutDefaults(
  CollectionRowQuotationInputSchema.omit({ rowId: true })
);
export type CollectionRowQuotationUpdate = z.infer<
  typeof CollectionRowQuotationUpdateSchema
>;

/** Bozza quotazione bufferizzata client-side nel drawer riga: `id` presente = riga esistente da
 *  aggiornare, assente = nuova da creare. `order` omesso: il server lo ricalcola dalla posizione
 *  nell'array inviato al salvataggio (non ha senso lasciarlo al client con inserimenti/cancellazioni
 *  intrecciati). */
export const CollectionRowQuotationDraftSchema = CollectionRowQuotationInputSchema
  .omit({ rowId: true, order: true })
  .extend({ id: z.string().uuid().optional() });
export type CollectionRowQuotationDraft = z.infer<
  typeof CollectionRowQuotationDraftSchema
>;

/**
 * Input schema for a catalog item. `iso9001Categories` is optional on every type: the ISO 9001
 * register is no longer enforced, so a catalog item is usable without one.
 */
export const CollectionCatalogItemInputSchema = z.object({
  type: z.enum(COLLECTION_CATALOG_TYPES),
  value: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  order: z.number().int().min(0).optional(),
  iso9001Categories: z.array(z.enum(ISO9001_CATEGORIES)).optional().nullable(),
});
export type CollectionCatalogItemInput = z.infer<
  typeof CollectionCatalogItemInputSchema
>;

// ─── Revision schemas ─────────────────────────────────────────────────────────

/**
 * What a user may ask for when creating a revision by hand. `cause` and `milestoneId` are
 * deliberately absent: the manual endpoint cannot express an automatic revision, so nothing has to
 * guard against one being forged. The automatic triggers bypass this schema and call the service
 * directly.
 */
export const CreateRevisionRequestSchema = z.object({
  collectionLayoutId: z.string().uuid(),
  revisionTypeValue: z.string().min(1),
  notes: z.string().max(1000).optional().nullable(),
});
export type CreateRevisionRequest = z.infer<typeof CreateRevisionRequestSchema>;

/**
 * Service-level input for `createRevision`. The cause/milestone pairing is a union rather than a
 * runtime refinement: a MILESTONE revision without its event, or a MANUAL one carrying an event,
 * does not typecheck in the first place.
 */
export type CreateRevisionInput = CreateRevisionRequest &
  ({ cause: 'MANUAL'; milestoneId?: null } | { cause: 'MILESTONE'; milestoneId: string });

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
