'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSession } from 'next-auth/react';
import React, { useEffect, useRef } from 'react';
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
  const { data: session } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        supplier: row.supplier,
        line: row.line,
        status: row.status as CollectionLayoutRowInput['status'],
        skuForecast: row.skuForecast,
        qtyForecast: row.qtyForecast,
        productCategory: row.productCategory,
        strategy: (row.strategy as CollectionLayoutRowInput['strategy']) ?? null,
        styleStatus: (row.styleStatus as CollectionLayoutRowInput['styleStatus']) ?? null,
        progress: (row.progress as CollectionLayoutRowInput['progress']) ?? null,
        designer: row.designer ?? null,
        pictureUrl: row.pictureUrl ?? null,
        styleNotes: row.styleNotes ?? null,
        materialNotes: row.materialNotes ?? null,
        colorNotes: row.colorNotes ?? null,
        priceNotes: row.priceNotes ?? null,
        toolingNotes: row.toolingNotes ?? null,
        dutyCategory: (row.dutyCategory as CollectionLayoutRowInput['dutyCategory']) ?? null,
        pricingParameterSetId: row.pricingParameterSetId ?? null,
        retailTargetPrice: row.retailTargetPrice ?? null,
        buyingTargetPrice: row.buyingTargetPrice ?? null,
        supplierFirstQuotation: row.supplierFirstQuotation ?? null,
        toolingQuotation: row.toolingQuotation ?? null,
      });
    } else {
      form.reset(buildDefaultValues(defaultGroupId, groups));
    }
  }, [open, mode, row?.id, defaultGroupId]);

  const { selectedParamSet, marginCalc } = usePricingCalc(form, parameterSets);
  const pictureUrl = form.watch('pictureUrl');
  const title = mode === 'create' ? 'Nuova riga' : (row?.line ?? 'Modifica riga');

  const handlePictureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      const res = await fetch(url, { method: 'POST', headers, body: formData });
      if (!res.ok) throw new Error(`Upload fallito (${res.status})`);
      const data = await res.json();
      form.setValue('pictureUrl', data.publicUrl);
      onPictureUploaded?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Errore durante upload');
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" side="right">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="text-lg">{title}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-6">
            <IdentificationSection
              control={form.control}
              canUpdate={canUpdate}
              mode={mode}
              pictureUrl={pictureUrl}
              fileInputRef={fileInputRef}
              onRemovePicture={() => form.setValue('pictureUrl', null)}
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

            {/* Footer */}
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
