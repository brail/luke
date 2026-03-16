'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Image, Upload, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import type { RouterOutputs } from '@luke/api';
import {
  COLLECTION_GENDER,
  COLLECTION_STRATEGY,
  COLLECTION_STATUS,
  COLLECTION_PROGRESS,
  COLLECTION_DUTY_CATEGORY,
  CollectionLayoutRowInputSchema,
  type CollectionLayoutRowInput,
  buildCollectionRowPictureUploadUrl,
} from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import {
  Form,
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
import { Separator } from '../../../../../components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../../../../../components/ui/sheet';
import { Textarea } from '../../../../../components/ui/textarea';

type CollectionGroup = RouterOutputs['collectionLayout']['get'] extends infer L
  ? L extends null
    ? never
    : L extends { groups: Array<infer G> }
      ? G
      : never
  : never;
type CollectionRow = CollectionGroup extends { rows: Array<infer R> } ? R : never;
type PricingParameterSet =
  RouterOutputs['pricing']['parameterSets']['list'][number];

interface CollectionRowDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  row?: CollectionRow;
  defaultGroupId?: string;
  groups: CollectionGroup[];
  parameterSets: PricingParameterSet[];
  onSubmit: (data: CollectionLayoutRowInput) => void;
  onPictureUploaded?: () => void;
  isLoading?: boolean;
  canUpdate?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  CARRY_OVER: 'Carry Over',
  NEW: 'Nuovo',
};

const STRATEGY_LABELS: Record<string, string> = {
  CORE: 'Core',
  INNOVATION: 'Innovation',
};

const DUTY_LABELS: Record<string, string> = {
  PELLE: 'Pelle',
  SINTETICO_TESSUTO: 'Sintetico / Tessuto',
};

export function CollectionRowDrawer({
  open,
  onOpenChange,
  mode,
  row,
  defaultGroupId,
  groups,
  parameterSets,
  onSubmit,
  onPictureUploaded,
  isLoading = false,
  canUpdate = true,
}: CollectionRowDrawerProps) {
  const { data: session } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<CollectionLayoutRowInput>({
    resolver: zodResolver(CollectionLayoutRowInputSchema),
    defaultValues: {
      groupId: defaultGroupId ?? groups[0]?.id ?? '',
      gender: 'MAN',
      supplier: '',
      line: '',
      status: 'NEW',
      skuForecast: 0,
      qtyForecast: 0,
      productCategory: '',
      strategy: null,
      styleStatus: null,
      progress: null,
      designer: null,
      pictureUrl: null,
      styleNotes: null,
      materialNotes: null,
      colorNotes: null,
      priceNotes: null,
      toolingNotes: null,
      dutyCategory: null,
      pricingParameterSetId: null,
      retailTargetPrice: null,
      buyingTargetPrice: null,
      supplierFirstQuotation: null,
      toolingQuotation: null,
    },
  });

  useEffect(() => {
    if (open) {
      if (mode === 'edit' && row) {
        form.reset({
          groupId: row.groupId,
          gender: row.gender as any,
          supplier: row.supplier,
          line: row.line,
          status: row.status as any,
          skuForecast: row.skuForecast,
          qtyForecast: row.qtyForecast,
          productCategory: row.productCategory,
          strategy: (row.strategy as any) ?? null,
          styleStatus: (row.styleStatus as any) ?? null,
          progress: (row.progress as any) ?? null,
          designer: row.designer ?? null,
          pictureUrl: row.pictureUrl ?? null,
          styleNotes: row.styleNotes ?? null,
          materialNotes: row.materialNotes ?? null,
          colorNotes: row.colorNotes ?? null,
          priceNotes: row.priceNotes ?? null,
          toolingNotes: row.toolingNotes ?? null,
          dutyCategory: (row.dutyCategory as any) ?? null,
          pricingParameterSetId: row.pricingParameterSetId ?? null,
          retailTargetPrice: row.retailTargetPrice ?? null,
          buyingTargetPrice: row.buyingTargetPrice ?? null,
          supplierFirstQuotation: row.supplierFirstQuotation ?? null,
          toolingQuotation: row.toolingQuotation ?? null,
        });
      } else {
        form.reset({
          groupId: defaultGroupId ?? groups[0]?.id ?? '',
          gender: 'MAN',
          supplier: '',
          line: '',
          status: 'NEW',
          skuForecast: 0,
          qtyForecast: 0,
          productCategory: '',
          strategy: null,
          styleStatus: null,
          progress: null,
          designer: null,
          pictureUrl: null,
          styleNotes: null,
          materialNotes: null,
          colorNotes: null,
          priceNotes: null,
          toolingNotes: null,
          dutyCategory: null,
          pricingParameterSetId: null,
          retailTargetPrice: null,
          buyingTargetPrice: null,
          supplierFirstQuotation: null,
          toolingQuotation: null,
        });
      }
    }
  }, [open, mode, row?.id, defaultGroupId]);

  // Watch pricing fields for margin calculation and buying target
  const watchedPricingSetId = form.watch('pricingParameterSetId');
  const watchedSupplierQuotation = form.watch('supplierFirstQuotation');
  const watchedRetailPrice = form.watch('retailTargetPrice');

  const selectedParamSet = useMemo(
    () =>
      watchedPricingSetId
        ? parameterSets.find(ps => ps.id === watchedPricingSetId)
        : null,
    [watchedPricingSetId, parameterSets]
  );

  // ─── Pure calc helpers (mirrors pricing.service.ts) ──────────────
  const companyMultiplier = useMemo(
    () =>
      selectedParamSet
        ? Math.round((1 / (1 - selectedParamSet.optimalMargin / 100)) * 100) / 100
        : null,
    [selectedParamSet]
  );

  // Full landed cost from supplier quotation
  const landedCostCalc = useCallback(
    (quotation: number, ps: typeof selectedParamSet) => {
      if (!ps) return null;
      const qc = quotation * (ps.qualityControlPercent / 100);
      const withQC = quotation + qc + ps.tools;
      const withTransport = withQC + ps.transportInsuranceCost;
      const duty = withTransport * (ps.duty / 100);
      const withDuty = withTransport + duty;
      return withDuty / ps.exchangeRate + ps.italyAccessoryCosts;
    },
    []
  );

  // Buying target (inverse calc from retail)
  const buyingTargetCalc = useCallback(
    (retail: number, ps: typeof selectedParamSet, cm: number | null) => {
      if (!ps || !cm) return null;
      const wholesale = retail / ps.retailMultiplier;
      const landed = wholesale / cm;
      const withoutAcc = landed - ps.italyAccessoryCosts;
      const withoutDuty = withoutAcc / (1 + ps.duty / 100);
      const withoutTransport = withoutDuty * ps.exchangeRate - ps.transportInsuranceCost;
      const raw = withoutTransport / (1 + ps.qualityControlPercent / 100) - ps.tools;
      return Math.floor(raw * 10) / 10;
    },
    []
  );

  // Margin: (wholesale - landed) / wholesale — same as calculateMarginOnly
  const marginCalc = useMemo(() => {
    if (
      !selectedParamSet ||
      !companyMultiplier ||
      !watchedSupplierQuotation ||
      !watchedRetailPrice ||
      watchedSupplierQuotation <= 0 ||
      watchedRetailPrice <= 0
    ) {
      return null;
    }
    const landed = landedCostCalc(watchedSupplierQuotation, selectedParamSet);
    if (landed === null) return null;
    const wholesale = watchedRetailPrice / selectedParamSet.retailMultiplier;
    const margin = (wholesale - landed) / wholesale;
    return {
      landedCost: Math.round(landed * 100) / 100,
      wholesalePrice: Math.round(wholesale * 100) / 100,
      companyMargin: Math.round(margin * 10000) / 10000,
      isAboveTarget: margin * 100 >= selectedParamSet.optimalMargin,
      optimalMargin: selectedParamSet.optimalMargin,
    };
  }, [selectedParamSet, companyMultiplier, watchedSupplierQuotation, watchedRetailPrice, landedCostCalc]);

  // Auto-fill buying target when retail price or parameter set changes
  useEffect(() => {
    if (!watchedRetailPrice || watchedRetailPrice <= 0 || !selectedParamSet) return;
    const target = buyingTargetCalc(watchedRetailPrice, selectedParamSet, companyMultiplier);
    if (target !== null && target > 0) {
      form.setValue('buyingTargetPrice', target, { shouldDirty: false });
    }
  }, [watchedRetailPrice, selectedParamSet?.id]);

  const handlePictureUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !row?.id) return;

    const formData = new globalThis.FormData();
    formData.append('file', file);

    try {
      const url = buildCollectionRowPictureUploadUrl(row.id);
      const headers: Record<string, string> = {};
      if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload fallito (${res.status})`);
      const data = await res.json();
      form.setValue('pictureUrl', data.publicUrl);
      onPictureUploaded?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore durante upload';
      toast.error(msg);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pictureUrl = form.watch('pictureUrl');
  const title = mode === 'create' ? 'Nuova riga' : (row?.line ?? 'Modifica riga');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="text-lg">{title}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6 py-6"
          >
            {/* ─── Sezione 1: Identificazione ─── */}
            <div className="space-y-4">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Identificazione
              </p>

              <div className="grid grid-cols-2 gap-4">
                {/* Gender */}
                <FormField
                  control={form.control}
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
                  control={form.control}
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
                  control={form.control}
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
                  control={form.control}
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
                {/* Supplier */}
                <FormField
                  control={form.control}
                  name="supplier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fornitore *</FormLabel>
                      <FormControl>
                        <Input placeholder="es. MINUS" {...field} disabled={!canUpdate} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Designer */}
                <FormField
                  control={form.control}
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
                {/* Status (LINE STATUS) */}
                <FormField
                  control={form.control}
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
                  control={form.control}
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
                control={form.control}
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

              {/* Picture (solo edit) */}
              {mode === 'edit' && (
                <div className="space-y-2">
                  <Label>Foto</Label>
                  <div className="flex items-center gap-4">
                    {pictureUrl ? (
                      <div className="relative">
                        <img
                          src={pictureUrl}
                          alt="Foto riga"
                          className="h-36 w-48 rounded-md object-contain border bg-muted/5"
                        />
                        {canUpdate && (
                          <button
                            type="button"
                            onClick={() => form.setValue('pictureUrl', null)}
                            className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="h-36 w-48 rounded-md border border-dashed flex items-center justify-center bg-muted/30">
                        <Image className="h-10 w-10 text-muted-foreground" />
                      </div>
                    )}
                    {canUpdate && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="h-4 w-4 mr-2" />
                          {pictureUrl ? 'Cambia foto' : 'Carica foto'}
                        </Button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={handlePictureUpload}
                        />
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* ─── Sezione 2: Forecast & Gruppo ─── */}
            <div className="space-y-4">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Forecast & Gruppo
              </p>

              <div className="grid grid-cols-2 gap-4">
                {/* SKU Forecast */}
                <FormField
                  control={form.control}
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
                          disabled={!canUpdate}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Qty Forecast */}
                <FormField
                  control={form.control}
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
                control={form.control}
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

            <Separator />

            {/* ─── Sezione 3: Prezzi & Margini ─── */}
            <div className="space-y-4">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Prezzi & Margini
              </p>

              {/* Parameter Set */}
              <FormField
                control={form.control}
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

              <FormField
                control={form.control}
                name="dutyCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria dazio</FormLabel>
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
                        {COLLECTION_DUTY_CATEGORY.map(d => (
                          <SelectItem key={d} value={d}>
                            {DUTY_LABELS[d]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
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
                          onChange={e =>
                            field.onChange(
                              e.target.value !== '' && !isNaN(parseFloat(e.target.value)) && parseFloat(e.target.value) > 0 ? parseFloat(e.target.value) : null
                            )
                          }
                          disabled={!canUpdate}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
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
                <FormField
                  control={form.control}
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
                          onChange={e =>
                            field.onChange(
                              e.target.value !== '' && !isNaN(parseFloat(e.target.value)) && parseFloat(e.target.value) > 0 ? parseFloat(e.target.value) : null
                            )
                          }
                          disabled={!canUpdate}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
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
                          onChange={e =>
                            field.onChange(
                              e.target.value !== '' && !isNaN(parseFloat(e.target.value)) && parseFloat(e.target.value) > 0 ? parseFloat(e.target.value) : null
                            )
                          }
                          disabled={!canUpdate}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Margin calculation block */}
              {marginCalc && (
                <div
                  className={`rounded-lg border p-4 space-y-2 ${
                    marginCalc.isAboveTarget
                      ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20'
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
                          marginCalc.isAboveTarget
                            ? 'text-green-700 dark:text-green-400'
                            : 'text-red-700 dark:text-red-400'
                        }`}
                      >
                        {(marginCalc.companyMargin * 100).toFixed(1)}%
                      </span>
                      <Badge
                        variant={marginCalc.isAboveTarget ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        target {marginCalc.optimalMargin}%
                      </Badge>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* ─── Sezione 4: Note ─── */}
            <div className="space-y-4">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Note
              </p>

              {(
                [
                  ['styleNotes', 'Note stile'],
                  ['materialNotes', 'Note materiali'],
                  ['colorNotes', 'Note colori'],
                  ['priceNotes', 'Note prezzi'],
                  ['toolingNotes', 'Note impianti'],
                ] as const
              ).map(([fieldName, label]) => (
                <FormField
                  key={fieldName}
                  control={form.control}
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
                          onChange={e =>
                            field.onChange(e.target.value || null)
                          }
                          disabled={!canUpdate}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            {/* ─── Footer ─── */}
            <div className="flex justify-end gap-3 pt-4 border-t sticky bottom-0 bg-background pb-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Annulla
              </Button>
              {canUpdate && (
                <Button type="submit" disabled={isLoading}>
                  {isLoading
                    ? 'Salvataggio…'
                    : mode === 'create'
                      ? 'Crea riga'
                      : 'Salva modifiche'}
                </Button>
              )}
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
