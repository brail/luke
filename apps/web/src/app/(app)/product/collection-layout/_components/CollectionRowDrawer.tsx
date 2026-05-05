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

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../../../../components/ui/accordion';
import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Form } from '../../../../../components/ui/form';
import { Separator } from '../../../../../components/ui/separator';
import { useStorageUpload } from '../../../../../hooks/useStorageUpload';
import { usePricingCalc } from '../_hooks/usePricingCalc';

import {
  ForecastGroupSection,
  IdentificationSection,
  NotesSection,
  PictureSidePanel,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-full p-0 gap-0 flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
            {/* Two-column body */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* Left column — Identificazione + Forecast */}
              <div className="flex-[3] overflow-y-auto px-6 py-6 space-y-6 border-r">
                <IdentificationSection
                  control={form.control}
                  canUpdate={canUpdate}
                  mode={mode}
                />

                <Separator />

                <ForecastGroupSection
                  control={form.control}
                  canUpdate={canUpdate}
                  groups={groups}
                />
              </div>

              {/* Right column — Foto + Pricing + Note */}
              <div className="flex-[2] overflow-y-auto px-6 py-6 space-y-6">
                {mode === 'edit' && (
                  <>
                    <PictureSidePanel
                      canUpdate={canUpdate}
                      pictureUrl={previewPictureUrl}
                      onRemovePicture={() => { form.setValue('pictureKey', null); setPreviewPictureUrl(null); }}
                      onUploadPicture={handlePictureUpload}
                    />
                    <Separator />
                  </>
                )}

                <PricingSection
                  control={form.control}
                  canUpdate={canUpdate}
                  parameterSets={parameterSets}
                  selectedParamSet={selectedParamSet}
                  marginCalc={marginCalc}
                />

                <Separator />

                <Accordion type="single" collapsible defaultValue={undefined}>
                  <AccordionItem value="notes" className="border-none">
                    <AccordionTrigger className="text-sm font-semibold text-muted-foreground uppercase tracking-wider py-0 hover:no-underline">
                      Note
                    </AccordionTrigger>
                    <AccordionContent className="pt-4">
                      <NotesSection control={form.control} canUpdate={canUpdate} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="flex justify-end gap-3 px-6 py-4 border-t shrink-0">
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
      </DialogContent>
    </Dialog>
  );
}
