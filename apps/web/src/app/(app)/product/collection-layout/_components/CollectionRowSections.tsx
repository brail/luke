'use client';

import { Image, Plus, Trash2, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import { calcMaxSupplierCost, type CollectionLayoutRowInput } from '@luke/core';

import { NumberInput } from '../../../../../components/NumberInput';
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

import { VendorCombobox } from './VendorCombobox';

import type { PricingParameterSet } from '../_hooks/usePricingCalc';
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
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

export function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {title}
    </p>
  );
}

function parsePositiveFloat(value: string): number | null {
  const parsed = parseFloat(value);
  return value !== '' && !isNaN(parsed) && parsed > 0 ? parsed : null;
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

// ─── Section: Identificazione ─────────────────────────────────────────────────

interface IdentificationSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
  availableGenders: string[];
  groups: CollectionGroup[];
}

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
  const { data: progressOptions = [] } = trpc.collectionCatalog.list.useQuery(
    { type: 'progress' },
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
        <FormField
          control={control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Line Status *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value} disabled={!canUpdate}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  {lineStatusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="styleStatus"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Style Status</FormLabel>
              <Select
                onValueChange={v => field.onChange(v === '_none' ? null : v)}
                value={field.value ?? '_none'}
                disabled={!canUpdate}
              >
                <FormControl><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="_none">—</SelectItem>
                  {styleStatusOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* designer | progress */}
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

        <FormField
          control={control}
          name="progress"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Progress</FormLabel>
              <Select
                onValueChange={v => field.onChange(v === '_none' ? null : v)}
                value={field.value ?? '_none'}
                disabled={!canUpdate}
              >
                <FormControl><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger></FormControl>
                <SelectContent>
                  <SelectItem value="_none">—</SelectItem>
                  {progressOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* strategy — single field full-width hidden-ish but kept for data entry */}
      <FormField
        control={control}
        name="strategy"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Strategy</FormLabel>
            <Select
              onValueChange={v => field.onChange(v === '_none' ? null : v)}
              value={field.value ?? '_none'}
              disabled={!canUpdate}
            >
              <FormControl><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="_none">—</SelectItem>
                {strategyOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

    </div>
  );
}

// ─── Section: Fornitore ───────────────────────────────────────────────────────

interface VendorSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
}

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

// ─── Section: Forecast ────────────────────────────────────────────────────────

interface ForecastSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
}

export function ForecastSection({ control, canUpdate }: ForecastSectionProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <FormField
        control={control}
        name="skuForecast"
        render={({ field }) => (
          <FormItem>
            <FormLabel>SKU Forecast *</FormLabel>
            <FormControl>
              <NumberInput
                {...field}
                value={isNaN(field.value as number) ? '' : field.value}
                onChange={e => field.onChange(parseInt(e.target.value, 10))}
                onFocus={e => e.target.select()}
                disabled={!canUpdate}
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
            <FormLabel>Qty Forecast *</FormLabel>
            <FormControl>
              <NumberInput
                {...field}
                value={isNaN(field.value as number) ? '' : field.value}
                onChange={e => field.onChange(parseInt(e.target.value, 10))}
                onFocus={e => e.target.select()}
                disabled={!canUpdate}
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
  onAddQuotation: () => void;
  onUpdateField: (id: string, field: keyof Pick<QuotationState, 'pricingParameterSetId' | 'retailPrice' | 'supplierQuotation' | 'notes'>, value: string | number | null) => void;
  onBlurQuotation: (id: string, overrides?: Partial<QuotationState>) => void;
  onDeleteQuotation: (id: string) => void;
  isAddingQuotation?: boolean;
}

export function PricingFooterSection({
  control,
  canUpdate,
  mode,
  quotations,
  parameterSets,
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
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {quotations.map(q => {
                    const ps = parameterSets.find(p => p.id === q.pricingParameterSetId) ?? null;
                    const calc = calcQuotationFields(q, ps);
                    const sellSym = ps ? (CURRENCY_SYMBOLS[ps.sellingCurrency] ?? ps.sellingCurrency) : '';
                    const buySym = ps ? (CURRENCY_SYMBOLS[ps.purchaseCurrency] ?? ps.purchaseCurrency) : '';
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
                            <SelectTrigger className={cn('h-7 text-xs w-full', !q.pricingParameterSetId && 'border-destructive/60 text-muted-foreground')}>
                              <SelectValue placeholder="Seleziona *" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_none">— Nessuno —</SelectItem>
                              {parameterSets.map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name} ({p.purchaseCurrency}/{p.sellingCurrency})
                                </SelectItem>
                              ))}
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
                              className={cn('h-7 text-xs w-[88px]', sellSym && 'pl-5')}
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
                              className={cn('h-7 text-xs w-[88px]', buySym && 'pl-5')}
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
                            className="h-7 text-xs w-full"
                            placeholder="Note…"
                            value={q.notes ?? ''}
                            onChange={e => onUpdateField(q.id, 'notes', e.target.value || null)}
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
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
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
