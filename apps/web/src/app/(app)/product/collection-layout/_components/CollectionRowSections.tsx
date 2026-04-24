'use client';

import { Image, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import type { RouterOutputs } from '@luke/api';
import {
  COLLECTION_GENDER,
  COLLECTION_PROGRESS,
  COLLECTION_STATUS,
  COLLECTION_STRATEGY,
  type CollectionLayoutRowInput,
} from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { FileDropZone } from '../../../../../components/ui/file-drop-zone';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../../../../components/ui/form';
import { Input } from '../../../../../components/ui/input';
import { Label } from '../../../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../../components/ui/select';
import { Textarea } from '../../../../../components/ui/textarea';
import { cn } from '../../../../../lib/utils';

import { VendorCombobox } from './VendorCombobox';

import type { MarginCalc, PricingParameterSet } from '../_hooks/usePricingCalc';
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

export type { PricingParameterSet };

// ─── Label maps ───────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  CARRY_OVER: 'Carry Over',
  NEW: 'Nuovo',
};

const STRATEGY_LABELS: Record<string, string> = {
  CORE: 'Core',
  INNOVATION: 'Innovation',
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Intestazione di sezione con stile uniforme. */
function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
      {title}
    </p>
  );
}

/** Converte stringa input in float positivo o null. */
function parsePositiveFloat(value: string): number | null {
  const parsed = parseFloat(value);
  return value !== '' && !isNaN(parsed) && parsed > 0 ? parsed : null;
}

// ─── Section: Identificazione ─────────────────────────────────────────────────

interface IdentificationSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
  mode: 'create' | 'edit';
  pictureUrl: string | null | undefined;
  onRemovePicture: () => void;
  onUploadPicture: (file: File) => void;
}

export function IdentificationSection({
  control,
  canUpdate,
  mode,
  pictureUrl,
  onRemovePicture,
  onUploadPicture,
}: IdentificationSectionProps) {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [pictureUrl]);

  return (
    <div className="space-y-4">
      <SectionHeader title="Identificazione" />

      <div className="grid grid-cols-2 gap-4">
        {/* Gender */}
        <FormField
          control={control}
          name="gender"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Gender *</FormLabel>
              <div className="flex gap-2">
                {COLLECTION_GENDER.map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => field.onChange(g)}
                    disabled={!canUpdate}
                    className={`flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                      field.value === g
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary/50'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Strategy */}
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
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona…" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="_none">—</SelectItem>
                  {COLLECTION_STRATEGY.map(s => (
                    <SelectItem key={s} value={s}>
                      {STRATEGY_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Line */}
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

        {/* Product Category */}
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

      <div className="grid grid-cols-2 gap-4">
        {/* Fornitore */}
        <FormField
          control={control}
          name="vendorId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Fornitore</FormLabel>
              <FormControl>
                <VendorCombobox
                  value={field.value ?? null}
                  onChange={field.onChange}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Designer */}
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
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Line Status */}
        <FormField
          control={control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Line Status *</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={!canUpdate}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {COLLECTION_STATUS.map(s => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Style Status */}
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
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="_none">—</SelectItem>
                  {COLLECTION_STATUS.map(s => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Progress */}
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
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona fase…" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="_none">—</SelectItem>
                {COLLECTION_PROGRESS.map(p => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Picture — solo in modalità edit */}
      {mode === 'edit' && (
        <div className="space-y-2">
          <Label>Foto</Label>
          <FileDropZone
            onFile={onUploadPicture}
            accept={['image/png', 'image/jpeg', 'image/webp']}
            maxSizeMB={5}
            disabled={!canUpdate}
            className={cn('rounded-md', canUpdate && 'cursor-pointer')}
          >
            <div className="flex items-center gap-4">
              {pictureUrl && !imgFailed ? (
                <div className="relative shrink-0">
                  <img
                    src={pictureUrl}
                    alt="Foto riga"
                    className="h-36 w-48 rounded-md object-contain border bg-muted/5"
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
                  'h-36 w-48 rounded-md border-2 border-dashed flex items-center justify-center bg-muted/20',
                  canUpdate ? 'border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/30' : 'border-muted'
                )}>
                  <Image className="h-10 w-10 text-muted-foreground/50" />
                </div>
              )}
              {canUpdate && (
                <p className="text-xs text-muted-foreground">
                  {pictureUrl ? 'Trascina per sostituire o clicca' : 'Trascina qui o clicca per caricare'}
                  <span className="block mt-0.5">PNG, JPEG, WebP · Max 5MB</span>
                </p>
              )}
            </div>
          </FileDropZone>
        </div>
      )}
    </div>
  );
}

// ─── Section: Forecast & Gruppo ───────────────────────────────────────────────

interface ForecastGroupSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
  groups: CollectionGroup[];
}

export function ForecastGroupSection({
  control,
  canUpdate,
  groups,
}: ForecastGroupSectionProps) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Forecast & Gruppo" />

      <div className="grid grid-cols-2 gap-4">
        {/* SKU Forecast */}
        <FormField
          control={control}
          name="skuForecast"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SKU Forecast *</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  {...field}
                  onChange={e => field.onChange(parseInt(e.target.value) || 0)}
                  onFocus={e => e.target.select()}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Qty Forecast */}
        <FormField
          control={control}
          name="qtyForecast"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Qty Forecast *</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  {...field}
                  onChange={e => field.onChange(parseInt(e.target.value) || 0)}
                  onFocus={e => e.target.select()}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Gruppo */}
      <FormField
        control={control}
        name="groupId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Gruppo *</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value}
              disabled={!canUpdate}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona gruppo…" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {groups.map(g => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

// ─── Section: Prezzi & Margini ────────────────────────────────────────────────

interface PricingSectionProps {
  control: Control<CollectionLayoutRowInput>;
  canUpdate: boolean;
  parameterSets: PricingParameterSet[];
  selectedParamSet: PricingParameterSet | null;
  marginCalc: MarginCalc | null;
}

export function PricingSection({
  control,
  canUpdate,
  parameterSets,
  selectedParamSet,
  marginCalc,
}: PricingSectionProps) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Prezzi & Margini" />

      {/* Parameter Set */}
      <FormField
        control={control}
        name="pricingParameterSetId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Parametri pricing</FormLabel>
            <Select
              onValueChange={v => field.onChange(v === '_none' ? null : v)}
              value={field.value ?? '_none'}
              disabled={!canUpdate}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona set parametri…" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="_none">— Nessuno —</SelectItem>
                {parameterSets.map(ps => (
                  <SelectItem key={ps.id} value={ps.id}>
                    {ps.name} ({ps.purchaseCurrency}/{ps.sellingCurrency})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-2 gap-4">
        {/* Retail Target Price */}
        <FormField
          control={control}
          name="retailTargetPrice"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Retail Target{' '}
                {selectedParamSet && (
                  <span className="text-muted-foreground text-xs">
                    ({selectedParamSet.sellingCurrency})
                  </span>
                )}
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                  {...field}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(parsePositiveFloat(e.target.value))}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Buying Target Price (read-only, calcolato) */}
        <FormField
          control={control}
          name="buyingTargetPrice"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-1.5">
                Buying Target
                {field.value != null && (
                  <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    calcolato
                  </span>
                )}
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="—"
                  value={field.value ?? ''}
                  readOnly
                  className="bg-muted/50 cursor-default"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Supplier First Quotation */}
        <FormField
          control={control}
          name="supplierFirstQuotation"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                1ª Quot. Fornitore{' '}
                {selectedParamSet && (
                  <span className="text-muted-foreground text-xs">
                    ({selectedParamSet.purchaseCurrency} FOB)
                  </span>
                )}
                <span className="text-muted-foreground text-xs font-normal ml-1">
                  opzionale
                </span>
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                  {...field}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(parsePositiveFloat(e.target.value))}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Tooling Quotation */}
        <FormField
          control={control}
          name="toolingQuotation"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Quot. Impianti (FOB)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="0.00"
                  {...field}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(parsePositiveFloat(e.target.value))}
                  disabled={!canUpdate}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Margin analysis block */}
      {marginCalc && (
        <div
          className={`rounded-lg border p-4 space-y-2 ${
            marginCalc.marginStatus === 'green'
              ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20'
              : marginCalc.marginStatus === 'yellow'
              ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'
              : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Analisi marginalità
          </p>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Landed Cost ({selectedParamSet?.sellingCurrency})
            </span>
            <span className="font-medium tabular-nums">
              {marginCalc.landedCost.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Wholesale ({selectedParamSet?.sellingCurrency})
            </span>
            <span className="font-medium tabular-nums">
              {marginCalc.wholesalePrice.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Margine aziendale</span>
            <div className="flex items-center gap-2">
              <span
                className={`font-bold tabular-nums ${
                  marginCalc.marginStatus === 'green'
                    ? 'text-green-700 dark:text-green-400'
                    : marginCalc.marginStatus === 'yellow'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {(marginCalc.companyMargin * 100).toFixed(1)}%
              </span>
              <Badge
                variant={marginCalc.marginStatus === 'red' ? 'destructive' : 'default'}
                className={`text-xs ${marginCalc.marginStatus === 'yellow' ? 'bg-amber-500 hover:bg-amber-500/90' : ''}`}
              >
                target {marginCalc.optimalMargin}%
              </Badge>
            </div>
          </div>
          {marginCalc.marginStatus !== 'green' && (
            <div className="flex items-center justify-between text-sm border-t pt-2 mt-1">
              <span className="text-muted-foreground">Retail suggerito</span>
              <span className="font-medium tabular-nums">
                {marginCalc.targetRetailPrice.toFixed(2)} {selectedParamSet?.sellingCurrency}
              </span>
            </div>
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
  ['priceNotes', 'Note prezzi'],
  ['toolingNotes', 'Note impianti'],
] as const;

export function NotesSection({ control, canUpdate }: NotesSectionProps) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Note" />

      {NOTE_FIELDS.map(([fieldName, label]) => (
        <FormField
          key={fieldName}
          control={control}
          name={fieldName}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
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
