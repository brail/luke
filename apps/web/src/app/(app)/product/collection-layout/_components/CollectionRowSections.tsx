'use client';

import { Image, Plus, Trash2, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import { calcMaxSupplierCost, type CollectionLayoutRowInput } from '@luke/core';

import { NumberInput } from '../../../../../components/NumberInput';
import { PhaseSelect } from '../../../../../components/PhaseSelect';
import { formatPlanningGroupLabel, PlanningGroupSelect } from '../../../../../components/PlanningGroupSelect';
import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { FileDropZone } from '../../../../../components/ui/file-drop-zone';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../../components/ui/form';
import { Input } from '../../../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { Textarea } from '../../../../../components/ui/textarea';
import { trpc } from '../../../../../lib/trpc';
import { cn } from '../../../../../lib/utils';
import { usePhaseCatalog } from '../_hooks/usePhaseCatalog';

import { CriticalityBadge } from './CriticalityBadge';
import { SchedulingVarianceBadge } from './SchedulingVarianceBadge';
import { VendorCombobox } from './VendorCombobox';

import type { PricingParameterSet } from '../../_shared/pricingCalc';
import type { Control } from 'react-hook-form';

// ─── Shared types ─────────────────────────────────────────────────────────────

export type CollectionGroup = RouterOutputs['collectionLayout']['get'] extends infer L
  ? L extends null
    ? never
    : L extends { groups: Array<infer G> }
      ? G
      : never
  : never;

export type CollectionRow = CollectionGroup extends { rows: Array<infer R> } ? R : never;
export type CollectionRowQuotation = CollectionRow extends { quotations: Array<infer Q> } ? Q : never;

export type { PricingParameterSet };

// Local state shape for quotation editing
export type QuotationState = {
  id: string;
  rowId: string;
  order: number;
  pricingParameterSetId: string | null;
  retailPrice: number | null;
  supplierQuotation: number | null;
  notes: string | null;
  sku: number | null;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Styled section heading used between form sections in the row drawer. */
export function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {title}
    </p>
  );
}

/**
 * Fixed-height label for the compact Pianificazione fields. Forces phase and
 * planning-group labels to the same height so the two selects below them align
 * even when the phase label carries criticality/variance badges. Shared so the
 * height can't drift between the fields.
 */
const PLANNING_FIELD_LABEL = 'flex h-6 items-center';

function parsePositiveFloat(value: string): number | null {
  const parsed = parseFloat(value);
  return value !== '' && !isNaN(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInt(value: string): number | null {
  const parsed = parseInt(value, 10);
  return !isNaN(parsed) && parsed >= 1 ? parsed : null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', CHF: 'CHF', CNY: '¥',
};

function fmtCurrency(symbol: string, value: number) {
  return `${symbol}${value.toFixed(2)}`;
}

type QuotationCalc = {
  bt: number | null;
  lc: number | null;
  ws: number | null;
  marginPct: number | null;
  marginStatus: 'green' | 'yellow' | 'red' | null;
  targetMargin: number;
};

function calcQuotationFields(q: QuotationState, ps: PricingParameterSet | null): QuotationCalc | null {
  if (!ps) return null;

  // BT only needs retail + param set
  const bt = q.retailPrice && q.retailPrice > 0
    ? Math.round(calcMaxSupplierCost(q.retailPrice, ps) * 100) / 100
    : null;

  // LC / WS / margin need supplier quotation too
  if (!q.supplierQuotation || q.supplierQuotation <= 0 || !q.retailPrice || q.retailPrice <= 0) {
    return { bt, lc: null, ws: null, marginPct: null, marginStatus: null, targetMargin: ps.optimalMargin };
  }

  const qc = q.supplierQuotation * (ps.qualityControlPercent / 100);
  const withQC = q.supplierQuotation + qc + ps.tools;
  const withTransport = withQC + ps.transportInsuranceCost;
  const withDuty = withTransport * (1 + ps.duty / 100);
  const lc = withDuty / ps.exchangeRate + ps.italyAccessoryCosts;
  const ws = q.retailPrice / ps.retailMultiplier;
  const marginPct = ((ws - lc) / ws) * 100;
  const marginStatus: 'green' | 'yellow' | 'red' =
    marginPct >= ps.optimalMargin ? 'green'
    : marginPct >= ps.optimalMargin - 3 ? 'yellow'
    : 'red';
  return {
    bt,
    lc: Math.round(lc * 100) / 100,
    ws: Math.round(ws * 100) / 100,
    marginPct: Math.round(marginPct * 10) / 10,
    marginStatus,
    targetMargin: ps.optimalMargin,
  };
}

// ─── Field: Catalog select ────────────────────────────────────────────────────

interface CatalogSelectFieldProps {
  control: Control<CollectionLayoutRowInput>;
  name: 'status' | 'styleStatus' | 'strategy' | 'pricePositioning';
  label: string;
  options: { value: string; label: string }[];
  canUpdate: boolean;
  /** When false the field is required (no empty sentinel). Defaults to nullable. */
  nullable?: boolean;
}

/**
 * FormField wrapper for a collection-catalog Select. Nullable fields use the `_none`
 * sentinel (Radix Select can't represent an empty value) mapped to/from `null`;
 * required fields (`nullable={false}`) bind the value directly.
 */
function CatalogSelectField({ control, name, label, options, canUpdate, nullable = true }: CatalogSelectFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            onValueChange={nullable ? v => field.onChange(v === '_none' ? null : v) : field.onChange}
            // `?? '_none'` is harmless for required fields — their value is never null.
            value={field.value ?? '_none'}
            disabled={!canUpdate}
          >
            <FormControl>
              <SelectTrigger><SelectValue placeholder={nullable ? '—' : undefined} /></SelectTrigger>
            </FormControl>
            <SelectContent>
              {nullable && <SelectItem value="_none">—</SelectItem>}
              {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ─── Section: Identificazione ─────────────────────────────────────────────────

interface IdentificationSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
  availableGenders: string[];
  groups: CollectionGroup[];
}

/**
 * Form section for the core identity fields of a collection row:
 * group, gender, category, line, article, status, designer, strategy, and
 * price positioning. Planning group and phase live in `PlanningSection`.
 * Catalog options (strategy, lineStatus, styleStatus) are fetched from tRPC.
 */
export function IdentificationSection({
  control,
  canUpdate,
  availableGenders,
  groups,
}: IdentificationSectionProps) {
  const { data: strategyOptions = [] } = trpc.collectionCatalog.list.useQuery(
    { type: 'strategy' },
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: lineStatusOptions = [] } = trpc.collectionCatalog.list.useQuery(
    { type: 'lineStatus' },
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: styleStatusOptions = [] } = trpc.collectionCatalog.list.useQuery(
    { type: 'styleStatus' },
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: pricePositioningOptions = [] } = trpc.collectionCatalog.list.useQuery(
    { type: 'pricePositioning' },
    { staleTime: 5 * 60 * 1000 }
  );

  return (
    <div className="space-y-4">
      <SectionHeader title="Identificazione" />

      {/* gruppo */}
      <GroupSelectField control={control} canUpdate={canUpdate} groups={groups} />

      {/* gender | categoria */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="gender"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Gender *</FormLabel>
              <div className="flex gap-2">
                {availableGenders.map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => field.onChange(g)}
                    disabled={!canUpdate}
                    className={cn(
                      'flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-colors',
                      field.value === g
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary/50',
                      'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="productCategory"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Categoria *</FormLabel>
              <FormControl>
                <Input placeholder="es. RUNNING" {...field} disabled={!canUpdate} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* linea | articolo */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="line"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Linea *</FormLabel>
              <FormControl>
                <Input placeholder="es. OZARK" {...field} disabled={!canUpdate} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="article"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Articolo</FormLabel>
              <FormControl>
                <Input
                  placeholder="es. 12345"
                  {...field}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.target.value || null)}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* line status | style status */}
      <div className="grid grid-cols-2 gap-4">
        <CatalogSelectField
          control={control}
          name="status"
          label="Line Status *"
          options={lineStatusOptions}
          canUpdate={canUpdate}
          nullable={false}
        />

        <CatalogSelectField
          control={control}
          name="styleStatus"
          label="Style Status"
          options={styleStatusOptions}
          canUpdate={canUpdate}
        />
      </div>

      {/* designer | strategy */}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={control}
          name="designer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Designer</FormLabel>
              <FormControl>
                <Input
                  placeholder="es. FEBOS"
                  {...field}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.target.value || null)}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <CatalogSelectField
          control={control}
          name="strategy"
          label="Strategy"
          options={strategyOptions}
          canUpdate={canUpdate}
        />
      </div>

      {/* posizionamento prezzo */}
      <div className="grid grid-cols-2 gap-4">
        <CatalogSelectField
          control={control}
          name="pricePositioning"
          label="Posizionamento Prezzo"
          options={pricePositioningOptions}
          canUpdate={canUpdate}
        />
      </div>

    </div>
  );
}

// ─── Section: Pianificazione ──────────────────────────────────────────────────

interface PlanningSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
  planningGroups: PlanningGroupOption[];
  mode: 'create' | 'edit';
  onRequestChangePlanningGroup?: () => void;
  /** Present only in edit mode — enables the criticality/variance badges next to the phase field. */
  rowId?: string;
}

/**
 * Planning/status band shown full-width above the identity grid: planning group
 * and phase, with the criticality and scheduling-variance badges those two
 * fields drive. Kept apart from the identity fields so process/status reads at
 * a glance.
 */
export function PlanningSection({
  control,
  canUpdate,
  planningGroups,
  mode,
  onRequestChangePlanningGroup,
  rowId,
}: PlanningSectionProps) {
  const { phases } = usePhaseCatalog();

  return (
    <div className="space-y-4">
      <SectionHeader title="Pianificazione" />
      <div className="grid grid-cols-2 gap-4">
        {/* fase */}
        <FormField
          control={control}
          name="phaseId"
          render={({ field }) => (
            <FormItem>
              <FormLabel className={cn(PLANNING_FIELD_LABEL, 'gap-1.5')}>
                Fase
                {rowId && <CriticalityBadge rowId={rowId} className="text-xs" />}
                {rowId && <SchedulingVarianceBadge rowId={rowId} className="text-xs" />}
              </FormLabel>
              <FormControl>
                <PhaseSelect
                  size="xs"
                  value={field.value ?? '_none'}
                  onValueChange={v => field.onChange(v === '_none' ? null : v)}
                  phases={phases}
                  disabled={!canUpdate}
                  noneLabel="—"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* gruppo di pianificazione */}
        <PlanningGroupSelectField
          control={control}
          canUpdate={canUpdate}
          planningGroups={planningGroups}
          mode={mode}
          onRequestChange={onRequestChangePlanningGroup}
        />
      </div>
    </div>
  );
}

// ─── Section: Fornitore ───────────────────────────────────────────────────────

interface VendorSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
}

/**
 * Form section for selecting the vendor of a collection row via `VendorCombobox`.
 */
export function VendorSection({ control, canUpdate }: VendorSectionProps) {
  return (
    <FormField
      control={control}
      name="vendorId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Fornitore</FormLabel>
          <FormControl>
            <VendorCombobox value={field.value ?? null} onChange={field.onChange} disabled={!canUpdate} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ─── Section: Foto ────────────────────────────────────────────────────────────

interface PictureSidePanelProps {
  canUpdate: boolean;
  pictureUrl: string | null | undefined;
  onRemovePicture: () => void;
  onUploadPicture: (file: File) => void;
}

/**
 * Side panel for previewing and uploading the collection row picture.
 *
 * Shows the current image with a remove button, or a `FileDropZone` when
 * empty. Upload is handled by the parent; this component only calls the
 * callbacks.
 *
 * @param onUploadPicture - Called with the selected File for upload.
 * @param onRemovePicture - Called when the user removes the existing picture.
 */
export function PictureSidePanel({
  canUpdate,
  pictureUrl,
  onRemovePicture,
  onUploadPicture,
}: PictureSidePanelProps) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [pictureUrl]);

  return (
    <div className="space-y-2">
      <SectionHeader title="Foto" />
      <FileDropZone
        onFile={onUploadPicture}
        accept={['image/png', 'image/jpeg', 'image/webp']}
        maxSizeMB={5}
        disabled={!canUpdate}
        className={cn('rounded-md', canUpdate && 'cursor-pointer')}
      >
        <div className="flex flex-col items-center gap-3 py-2">
          {pictureUrl && !imgFailed ? (
            <div className="relative">
              <img
                src={pictureUrl}
                alt="Foto riga"
                className="h-36 w-full max-w-xs rounded-md object-contain border bg-muted/5"
                onError={() => setImgFailed(true)}
              />
              {canUpdate && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); onRemovePicture(); }}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ) : (
            <div className={cn(
              'h-36 w-full rounded-md border-2 border-dashed flex items-center justify-center bg-muted/20',
              canUpdate ? 'border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/30' : 'border-muted'
            )}>
              <Image className="h-10 w-10 text-muted-foreground/50" />
            </div>
          )}
          {canUpdate && (
            <p className="text-xs text-muted-foreground text-center">
              {pictureUrl ? 'Trascina per sostituire o clicca' : 'Trascina qui o clicca per caricare'}
              <span className="block mt-0.5">PNG, JPEG, WebP · Max 5MB</span>
            </p>
          )}
        </div>
      </FileDropZone>
    </div>
  );
}

// ─── Section: Gruppo ──────────────────────────────────────────────────────────

interface GroupSelectFieldProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
  groups: CollectionGroup[];
}

/** Form field for selecting the parent group of a collection row. */
export function GroupSelectField({ control, canUpdate, groups }: GroupSelectFieldProps) {
  return (
    <FormField
      control={control}
      name="groupId"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Gruppo *</FormLabel>
          <Select onValueChange={field.onChange} value={field.value} disabled={!canUpdate}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Seleziona gruppo…" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {groups.map(g => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

// ─── Section: Gruppo di pianificazione ────────────────────────────────────────

interface PlanningGroupOption { id: string; name: string; isDefault: boolean; }

interface PlanningGroupSelectFieldProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
  planningGroups: PlanningGroupOption[];
  /** "create": plain selector (no calendar events depend on the row yet). "edit": read-only display
   * + explicit "Cambia gruppo" action, so changing it (which re-scopes calendar events) is never a
   * side effect of an unrelated field save. */
  mode: 'create' | 'edit';
  onRequestChange?: () => void;
}

export function PlanningGroupSelectField({
  control,
  canUpdate,
  planningGroups,
  mode,
  onRequestChange,
}: PlanningGroupSelectFieldProps) {
  return (
    <FormField
      control={control}
      name="planningGroupId"
      render={({ field }) => {
        if (mode === 'edit') {
          const current = planningGroups.find(g => g.id === field.value);
          return (
            <FormItem>
              <FormLabel className={PLANNING_FIELD_LABEL}>Gruppo di pianificazione</FormLabel>
              <div className="flex h-7 items-center justify-between gap-2 rounded-md border pl-3 pr-1">
                <span className="truncate text-xs">
                  {current ? formatPlanningGroupLabel(current) : '—'}
                </span>
                <Button type="button" variant="outline" size="sm" className="h-5 px-2 text-xs" disabled={!canUpdate} onClick={onRequestChange}>
                  Cambia gruppo
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          );
        }

        return (
          <FormItem>
            <FormLabel className={PLANNING_FIELD_LABEL}>Gruppo di pianificazione</FormLabel>
            <FormControl>
              <PlanningGroupSelect
                size="xs"
                value={field.value ?? ''}
                onValueChange={field.onChange}
                groups={planningGroups}
                disabled={!canUpdate}
                placeholder="Seleziona gruppo…"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

// ─── Section: Forecast ────────────────────────────────────────────────────────

interface ForecastSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
}

/** Form section for SKU forecast and quantity forecast fields. */
export function ForecastSection({ control, canUpdate }: ForecastSectionProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <FormField
        control={control}
        name="skuForecast"
        render={({ field }) => (
          <FormItem>
            <FormLabel>SKU Forecast</FormLabel>
            <FormControl>
              <NumberInput
                {...field}
                value={field.value == null || isNaN(field.value as number) ? '' : field.value}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  field.onChange(isNaN(v) ? null : v);
                }}
                onFocus={e => e.target.select()}
                disabled={!canUpdate}
                placeholder="—"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="qtyForecast"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Qty Forecast</FormLabel>
            <FormControl>
              <NumberInput
                {...field}
                value={field.value == null || isNaN(field.value as number) ? '' : field.value}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  field.onChange(isNaN(v) ? null : v);
                }}
                onFocus={e => e.target.select()}
                disabled={!canUpdate}
                placeholder="—"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

// ─── Section: Pricing Footer ──────────────────────────────────────────────────

interface PricingFooterSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
  mode: 'create' | 'edit';
  quotations: QuotationState[];
  parameterSets: PricingParameterSet[];
  enabledParameterSetIds: string[];
  onAddQuotation: () => void;
  onUpdateField: (id: string, field: keyof Pick<QuotationState, 'pricingParameterSetId' | 'retailPrice' | 'supplierQuotation' | 'notes' | 'sku'>, value: string | number | null) => void;
  onBlurQuotation: (id: string, overrides?: Partial<QuotationState>) => void;
  onDeleteQuotation: (id: string) => void;
  isAddingQuotation?: boolean;
}

/**
 * Form section for managing vendor quotations (price, supplier cost, SKU count)
 * and the tooling quotation field.
 *
 * Only parameter sets enabled for the selected vendor are available for
 * selection. Margin is computed live via `computeRowMargin` and displayed as a
 * colour-coded indicator.
 *
 * @param quotations - Current quotation list managed by the parent drawer.
 * @param enabledParameterSetIds - IDs of parameter sets enabled for the vendor.
 * @param onAddQuotation - Called to append a new empty quotation row.
 * @param onUpdateField - Called on every field change in a quotation row.
 * @param onBlurQuotation - Called on blur to persist a quotation via tRPC.
 * @param onDeleteQuotation - Called to remove a quotation row.
 */
export function PricingFooterSection({
  control,
  canUpdate,
  mode,
  quotations,
  parameterSets,
  enabledParameterSetIds,
  onAddQuotation,
  onUpdateField,
  onBlurQuotation,
  onDeleteQuotation,
  isAddingQuotation,
}: PricingFooterSectionProps) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Pricing" />

      {/* Impianti € + note impianti */}
      <div className="flex items-start gap-4">
        <FormField
          control={control}
          name="toolingQuotation"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 space-y-0 shrink-0">
              <FormLabel className="shrink-0 text-sm">Impianti (€)</FormLabel>
              <FormControl>
                <NumberInput
                  className="w-28"
                  placeholder="0.00"
                  step={0.01}
                  min={0}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(parsePositiveFloat(e.target.value))}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="toolingNotes"
          render={({ field }) => (
            <FormItem className="flex-1 flex items-center gap-3 space-y-0">
              <FormLabel className="shrink-0 text-sm">Note impianti</FormLabel>
              <FormControl>
                <Input
                  placeholder="…"
                  {...field}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.target.value || null)}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Quotations */}
      {mode === 'create' ? (
        <p className="text-sm text-muted-foreground italic">
          Salva la riga per aggiungere quotazioni pricing.
        </p>
      ) : (
        <div className="space-y-3">
          {quotations.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="text-sm table-fixed w-full" style={{ minWidth: 932 }}>
                <colgroup>
                  <col style={{ width: 252 }} />
                  <col style={{ width: 106 }} />
                  <col style={{ width: 106 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 68 }} />
                  <col style={{ width: 56 }} />
                  <col />{/* Note fills remaining width */}
                  <col style={{ width: 60 }} />
                  <col style={{ width: 36 }} />
                </colgroup>
                <thead>
                  <tr className="bg-muted/50 border-b text-muted-foreground text-xs">
                    <th className="text-left px-3 py-2 font-medium">Param Set</th>
                    <th className="text-left px-3 py-2 font-medium">Retail</th>
                    <th className="text-left px-3 py-2 font-medium">FOB</th>
                    <th className="text-right px-3 py-2 font-medium">BT</th>
                    <th className="text-right px-3 py-2 font-medium">LC</th>
                    <th className="text-right px-3 py-2 font-medium">WS</th>
                    <th className="text-center px-3 py-2 font-medium">M%</th>
                    <th className="text-center px-3 py-2 font-medium">TM</th>
                    <th className="text-left px-3 py-2 font-medium">Note</th>
                    <th className="text-center px-3 py-2 font-medium">SKU</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {quotations.map(q => {
                    const ps = parameterSets.find(p => p.id === q.pricingParameterSetId) ?? null;
                    const calc = calcQuotationFields(q, ps);
                    const sellSym = ps ? (CURRENCY_SYMBOLS[ps.sellingCurrency] ?? ps.sellingCurrency) : '';
                    const buySym = ps ? (CURRENCY_SYMBOLS[ps.purchaseCurrency] ?? ps.purchaseCurrency) : '';
                    const hasFilter = enabledParameterSetIds.length > 0;
                    const visibleParamSets = hasFilter
                      ? parameterSets.filter(p => enabledParameterSetIds.includes(p.id))
                      : parameterSets;
                    const orphanPs = hasFilter && q.pricingParameterSetId && !enabledParameterSetIds.includes(q.pricingParameterSetId)
                      ? parameterSets.find(p => p.id === q.pricingParameterSetId)
                      : null;
                    return (
                      <tr key={q.id} className="border-b last:border-0 hover:bg-muted/20">
                        {/* Param Set — required */}
                        <td className="px-3 py-1.5">
                          <Select
                            value={q.pricingParameterSetId ?? '_none'}
                            onValueChange={v => {
                              const val = v === '_none' ? null : v;
                              onUpdateField(q.id, 'pricingParameterSetId', val);
                              if (val !== null) onBlurQuotation(q.id, { pricingParameterSetId: val });
                            }}
                            disabled={!canUpdate}
                          >
                            <SelectTrigger size="xs" className={cn('w-full', !q.pricingParameterSetId && 'border-destructive/60 text-muted-foreground')}>
                              <SelectValue placeholder="Seleziona *" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_none">— Nessuno —</SelectItem>
                              {visibleParamSets.map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} ({p.purchaseCurrency}/{p.sellingCurrency})
                                </SelectItem>
                              ))}
                              {orphanPs && (
                                <SelectItem key={orphanPs.id} value={orphanPs.id} className="text-amber-600">
                                  ⚠ {orphanPs.name} ({orphanPs.purchaseCurrency}/{orphanPs.sellingCurrency})
                                  <span className="ml-1 text-xs opacity-70">non abilitato</span>
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </td>

                        {/* Retail */}
                        <td className="px-3 py-1.5">
                          <div className="relative">
                            {sellSym && (
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                                {sellSym}
                              </span>
                            )}
                            <NumberInput
                              inputSize="sm"
                              className={cn('w-[88px]', sellSym && 'pl-5')}
                              placeholder="0.00"
                              step={0.01}
                              min={0}
                              value={q.retailPrice ?? ''}
                              onChange={e => onUpdateField(q.id, 'retailPrice', parsePositiveFloat(e.target.value))}
                              onBlur={() => q.pricingParameterSetId && onBlurQuotation(q.id)}
                              disabled={!canUpdate || !q.pricingParameterSetId}
                            />
                          </div>
                        </td>

                        {/* FOB */}
                        <td className="px-3 py-1.5">
                          <div className="relative">
                            {buySym && (
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                                {buySym}
                              </span>
                            )}
                            <NumberInput
                              inputSize="sm"
                              className={cn('w-[88px]', buySym && 'pl-5')}
                              placeholder="0.00"
                              step={0.01}
                              min={0}
                              value={q.supplierQuotation ?? ''}
                              onChange={e => onUpdateField(q.id, 'supplierQuotation', parsePositiveFloat(e.target.value))}
                              onBlur={() => q.pricingParameterSetId && onBlurQuotation(q.id)}
                              disabled={!canUpdate || !q.pricingParameterSetId}
                            />
                          </div>
                        </td>

                        {/* BT (calc — needs ps + retail only) */}
                        <td className="px-3 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                          {calc?.bt != null ? fmtCurrency(buySym, calc.bt) : '—'}
                        </td>

                        {/* LC (calc — needs ps + retail + fob) */}
                        <td className="px-3 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                          {calc?.lc != null ? fmtCurrency(sellSym, calc.lc) : '—'}
                        </td>

                        {/* WS (calc) */}
                        <td className="px-3 py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                          {calc?.ws != null ? fmtCurrency(sellSym, calc.ws) : '—'}
                        </td>

                        {/* M% */}
                        <td className="px-3 py-1.5 text-center">
                          {calc?.marginPct != null && calc.marginStatus ? (
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-xs px-1.5',
                                calc.marginStatus === 'green' && 'border-green-500 text-green-700 bg-green-50 dark:bg-green-950/20 dark:text-green-400',
                                calc.marginStatus === 'yellow' && 'border-amber-500 text-amber-700 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400',
                                calc.marginStatus === 'red' && 'border-red-500 text-red-700 bg-red-50 dark:bg-red-950/20 dark:text-red-400'
                              )}
                            >
                              {calc.marginPct.toFixed(1)}%
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </td>

                        {/* TM */}
                        <td className="px-3 py-1.5 text-center tabular-nums text-xs text-muted-foreground">
                          {ps ? `${ps.optimalMargin}%` : '—'}
                        </td>

                        {/* Note */}
                        <td className="px-3 py-1.5">
                          <Input
                            inputSize="sm"
                            className="w-full"
                            placeholder="Note…"
                            value={q.notes ?? ''}
                            onChange={e => onUpdateField(q.id, 'notes', e.target.value || null)}
                            onBlur={() => q.pricingParameterSetId && onBlurQuotation(q.id)}
                            disabled={!canUpdate || !q.pricingParameterSetId}
                          />
                        </td>

                        {/* SKU (peso per media margine) */}
                        <td className="px-2 py-1.5">
                          <NumberInput
                            inputSize="sm"
                            className="w-14 text-center"
                            placeholder="—"
                            min={1}
                            step={1}
                            value={q.sku ?? ''}
                            onChange={e => onUpdateField(q.id, 'sku', parsePositiveInt(e.target.value))}
                            onBlur={() => q.pricingParameterSetId && onBlurQuotation(q.id)}
                            disabled={!canUpdate || !q.pricingParameterSetId}
                          />
                        </td>

                        {/* Delete */}
                        <td className="px-2 py-1.5">
                          {canUpdate && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => onDeleteQuotation(q.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canUpdate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAddQuotation}
              disabled={isAddingQuotation}
            >
              <Plus className="mr-1 h-3 w-3" />
              {isAddingQuotation ? 'Aggiunta…' : 'Aggiungi quotazione'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section: Note ────────────────────────────────────────────────────────────

interface NotesSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
}

const NOTE_FIELDS = [
  ['styleNotes', 'Note stile'],
  ['materialNotes', 'Note materiali'],
  ['colorNotes', 'Note colori'],
] as const;

/** Form section for the four free-text note fields of a collection row. */
export function NotesSection({ control, canUpdate }: NotesSectionProps) {
  return (
    <div className="flex flex-col h-full gap-4">
      {NOTE_FIELDS.map(([fieldName, label]) => (
        <FormField
          key={fieldName}
          control={control}
          name={fieldName}
          render={({ field }) => (
            <FormItem className="flex flex-col flex-1 min-h-0 space-y-1.5">
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Textarea
                  className="flex-1 resize-none min-h-0"
                  placeholder="…"
                  {...field}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.target.value || null)}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
    </div>
  );
}
