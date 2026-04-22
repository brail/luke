'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  CollectionLayoutRowInputSchema,
  type CollectionLayoutRowInput,
  buildCollectionRowPictureUploadUrl,
} from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import { Form } from '../../../../../components/ui/form';
import { Separator } from '../../../../../components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '../../../../../components/ui/sheet';
import { useStorageUpload } from '../../../../../hooks/useStorageUpload';
import { usePricingCalc } from '../_hooks/usePricingCalc';

import {
  ForecastGroupSection,
  IdentificationSection,
  NotesSection,
  PricingSection,
  type CollectionGroup,
  type CollectionRow,
  type PricingParameterSet,
} from './CollectionRowSections';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { CollectionGroup, CollectionRow, PricingParameterSet };

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDefaultValues(
  defaultGroupId?: string,
  groups: CollectionGroup[] = []
): CollectionLayoutRowInput {
  return {
    groupId: defaultGroupId ?? groups[0]?.id ?? '',
    gender: 'MAN',
    vendorId: null,
    line: '',
    status: 'NEW',
    skuForecast: 0,
    qtyForecast: 0,
    productCategory: '',
    strategy: null,
    styleStatus: null,
    progress: null,
    designer: null,
    pictureKey: null,
    styleNotes: null,
    materialNotes: null,
    colorNotes: null,
    priceNotes: null,
    toolingNotes: null,
    pricingParameterSetId: null,
    retailTargetPrice: null,
    buyingTargetPrice: null,
    supplierFirstQuotation: null,
    toolingQuotation: null,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Drawer laterale per creazione e modifica di una riga del collection layout.
 * Gestisce le sezioni: identificazione, forecast, prezzi/margini, note.
 */
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
  const [previewPictureUrl, setPreviewPictureUrl] = useState<string | null>(null);
  const { upload: uploadPicture } = useStorageUpload({
    fallbackProxyUrl: row?.id ? buildCollectionRowPictureUploadUrl(row.id) : undefined,
  });

  const form = useForm<CollectionLayoutRowInput>({
    resolver: zodResolver(CollectionLayoutRowInputSchema),
    defaultValues: buildDefaultValues(defaultGroupId, groups),
  });

  // Sincronizza i valori del form al cambio di riga o modalità
  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && row) {
      form.reset({
        groupId: row.groupId,
        gender: row.gender as CollectionLayoutRowInput['gender'],
        vendorId: row.vendorId ?? null,
        line: row.line,
        status: row.status as CollectionLayoutRowInput['status'],
        skuForecast: row.skuForecast,
        qtyForecast: row.qtyForecast,
        productCategory: row.productCategory,
        strategy: (row.strategy as CollectionLayoutRowInput['strategy']) ?? null,
        styleStatus: (row.styleStatus as CollectionLayoutRowInput['styleStatus']) ?? null,
        progress: (row.progress as CollectionLayoutRowInput['progress']) ?? null,
        designer: row.designer ?? null,
        pictureKey: row.pictureKey ?? null,
        styleNotes: row.styleNotes ?? null,
        materialNotes: row.materialNotes ?? null,
        colorNotes: row.colorNotes ?? null,
        priceNotes: row.priceNotes ?? null,
        toolingNotes: row.toolingNotes ?? null,
        pricingParameterSetId: row.pricingParameterSetId ?? null,
        retailTargetPrice: row.retailTargetPrice ?? null,
        buyingTargetPrice: row.buyingTargetPrice ?? null,
        supplierFirstQuotation: row.supplierFirstQuotation ?? null,
        toolingQuotation: row.toolingQuotation ?? null,
      });
      setPreviewPictureUrl(row.pictureUrl ?? null);
    } else {
      form.reset(buildDefaultValues(defaultGroupId, groups));
      setPreviewPictureUrl(null);
    }
  }, [open, mode, row?.id, defaultGroupId]);

  const { selectedParamSet, marginCalc } = usePricingCalc(form, parameterSets);
  const title = mode === 'create' ? 'Nuova riga' : (row?.line ?? 'Modifica riga');

  const handlePictureUpload = async (file: File) => {
    if (!row?.id) return;
    try {
      const { publicUrl, key } = await uploadPicture(file, 'collection-row-pictures');
      if (key) form.setValue('pictureKey', key);
      setPreviewPictureUrl(publicUrl);
      onPictureUploaded?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Errore durante upload');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl flex flex-col" side="right">
        <SheetHeader className="pb-4 border-b shrink-0">
          <SheetTitle className="text-lg">{title}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto space-y-6 py-6 px-1">
              <IdentificationSection
                control={form.control}
                canUpdate={canUpdate}
                mode={mode}
                pictureUrl={previewPictureUrl}
                onRemovePicture={() => { form.setValue('pictureKey', null); setPreviewPictureUrl(null); }}
                onUploadPicture={handlePictureUpload}
              />

              <Separator />

              <ForecastGroupSection
                control={form.control}
                canUpdate={canUpdate}
                groups={groups}
              />

              <Separator />

              <PricingSection
                control={form.control}
                canUpdate={canUpdate}
                parameterSets={parameterSets}
                selectedParamSet={selectedParamSet}
                marginCalc={marginCalc}
              />

              <Separator />

              <NotesSection control={form.control} canUpdate={canUpdate} />
            </div>

            {/* Footer fisso al fondo */}
            <div className="flex justify-end gap-3 px-1 py-4 border-t shrink-0">
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
