'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Download, FileText } from 'lucide-react';
import { useSession } from 'next-auth/react';
import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  CollectionLayoutRowInputSchema,
  type CollectionLayoutRowInput,
  buildCollectionRowPictureUploadUrl,
  buildTempCollectionRowPictureUploadUrl,
} from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { Form } from '../../../../../components/ui/form';
import { triggerDownload } from '../../../../../lib/download';
import { trpc } from '../../../../../lib/trpc';
import { getTrpcErrorMessage } from '../../../../../lib/trpcErrorMessages';

import {
  ForecastSection,
  IdentificationSection,
  NotesSection,
  PictureSidePanel,
  PricingFooterSection,
  SectionHeader,
  VendorSection,
  type CollectionGroup,
  type CollectionRow,
  type PricingParameterSet,
  type QuotationState,
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
  availableGenders: string[];
  onSubmit: (data: CollectionLayoutRowInput) => void;
  onPictureUploaded?: () => void;
  onQuotationChange?: () => void;
  isLoading?: boolean;
  canUpdate?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildDefaultValues(
  defaultGroupId?: string,
  groups: CollectionGroup[] = [],
  availableGenders: string[] = ['MAN', 'WOMAN']
): CollectionLayoutRowInput {
  return {
    groupId: defaultGroupId ?? groups[0]?.id ?? '',
    gender: availableGenders[0] ?? 'MAN',
    vendorId: null,
    line: '',
    article: null,
    status: 'NEW',
    skuForecast: 1,
    qtyForecast: 1,
    productCategory: '',
    strategy: null,
    styleStatus: null,
    progress: null,
    designer: null,
    pictureKey: null,
    pendingPictureFileObjectId: null,
    styleNotes: null,
    materialNotes: null,
    colorNotes: null,
    toolingNotes: null,
    toolingQuotation: null,
  };
}

function rowToQuotationState(q: CollectionRow['quotations'][number]): QuotationState {
  return {
    id: q.id,
    rowId: q.rowId,
    order: q.order,
    pricingParameterSetId: q.pricingParameterSetId ?? null,
    retailPrice: q.retailPrice ?? null,
    supplierQuotation: q.supplierQuotation ?? null,
    notes: q.notes ?? null,
    sku: q.sku ?? null,
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
  availableGenders,
  onSubmit,
  onPictureUploaded,
  onQuotationChange,
  isLoading = false,
  canUpdate = true,
}: CollectionRowDrawerProps) {
  const [previewPictureUrl, setPreviewPictureUrl] = useState<string | null>(null);
  const [isUploadingPicture, setIsUploadingPicture] = useState(false);
  const [quotations, setQuotations] = useState<QuotationState[]>([]);
  const { data: session } = useSession();

  const { data: vendorsList } = trpc.vendors.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  const form = useForm<CollectionLayoutRowInput>({
    resolver: zodResolver(CollectionLayoutRowInputSchema),
    defaultValues: buildDefaultValues(defaultGroupId, groups, availableGenders),
  });

  const currentVendorId = form.watch('vendorId');
  const enabledParameterSetIds = useMemo(
    () => vendorsList?.items.find(v => v.id === currentVendorId)?.enabledParameterSets.map(p => p.id) ?? [],
    [currentVendorId, vendorsList]
  );

  useEffect(() => {
    if (!open) {
      setPreviewPictureUrl(null);
      return;
    }
    if (mode === 'edit' && row) {
      form.reset({
        groupId: row.groupId,
        gender: row.gender,
        vendorId: row.vendorId ?? null,
        line: row.line,
        article: row.article ?? null,
        status: row.status,
        skuForecast: row.skuForecast,
        qtyForecast: row.qtyForecast,
        productCategory: row.productCategory,
        strategy: row.strategy ?? null,
        styleStatus: row.styleStatus ?? null,
        progress: row.progress ?? null,
        designer: row.designer ?? null,
        pictureKey: row.pictureKey ?? null,
        pendingPictureFileObjectId: null,
        styleNotes: row.styleNotes ?? null,
        materialNotes: row.materialNotes ?? null,
        colorNotes: row.colorNotes ?? null,
        toolingNotes: row.toolingNotes ?? null,
        toolingQuotation: row.toolingQuotation ?? null,
      });
      setPreviewPictureUrl(row.pictureUrl ?? null);
      setQuotations((row.quotations ?? []).map(rowToQuotationState));
    } else {
      form.reset(buildDefaultValues(defaultGroupId, groups, availableGenders));
      setPreviewPictureUrl(null);
      setQuotations([]);
    }
  }, [open, mode, row?.id, defaultGroupId]);

  const title = mode === 'create' ? 'Nuova riga' : (row?.line ?? 'Modifica riga');

  // ─── Picture upload — eager to temp/row endpoint, pending confirm on save ──
  const handlePictureUpload = async (file: File) => {
    const blobUrl = URL.createObjectURL(file);
    setPreviewPictureUrl(blobUrl);
    setIsUploadingPicture(true);

    try {
      const uploadUrl = row?.id
        ? buildCollectionRowPictureUploadUrl(row.id)
        : buildTempCollectionRowPictureUploadUrl();

      const formData = new globalThis.FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {};
      if (session?.accessToken) {
        headers['Authorization'] = `Bearer ${session.accessToken}`;
      }

      const res = await fetch(uploadUrl, { method: 'POST', headers, body: formData });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Upload fallito (${res.status})`);
      }

      const result = await res.json();
      URL.revokeObjectURL(blobUrl);
      setPreviewPictureUrl(result.publicUrl);
      form.setValue('pendingPictureFileObjectId', result.fileObjectId);
      onPictureUploaded?.();
    } catch (err: unknown) {
      URL.revokeObjectURL(blobUrl);
      setPreviewPictureUrl(null);
      form.setValue('pendingPictureFileObjectId', null);
      toast.error(err instanceof Error ? err.message : 'Errore durante upload foto');
    } finally {
      setIsUploadingPicture(false);
    }
  };

  const handlePictureRemove = () => {
    form.setValue('pictureKey', null);
    form.setValue('pendingPictureFileObjectId', null);
    setPreviewPictureUrl(null);
  };

  // ─── Quotation mutations ─────────────────────────────────────────
  const createQuotationMutation = trpc.collectionLayout.quotations.create.useMutation({
    onSuccess: newQ => {
      setQuotations(prev => [...prev, rowToQuotationState(newQ as unknown as CollectionRow['quotations'][number])]);
      onQuotationChange?.();
    },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const updateQuotationMutation = trpc.collectionLayout.quotations.update.useMutation({
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  const deleteQuotationMutation = trpc.collectionLayout.quotations.delete.useMutation({
    onSuccess: (_, vars) => {
      setQuotations(prev => prev.filter(q => q.id !== vars.quotationId));
      onQuotationChange?.();
    },
    onError: e => toast.error(getTrpcErrorMessage(e)),
  });

  // ─── Row export mutations ────────────────────────────────────────
  const exportRowXlsxMutation = trpc.collectionLayout.export.rowXlsx.useMutation({
    onSuccess: result =>
      triggerDownload(
        result.data,
        result.filename,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ),
    onError: e => toast.error(getTrpcErrorMessage(e, { default: "Errore durante l'esportazione XLSX" })),
  });

  const exportRowPdfMutation = trpc.collectionLayout.export.rowPdf.useMutation({
    onSuccess: result => triggerDownload(result.data, result.filename, 'application/pdf'),
    onError: e => toast.error(getTrpcErrorMessage(e, { default: "Errore durante l'esportazione PDF" })),
  });

  // ─── Quotation handlers ──────────────────────────────────────────
  const handleAddQuotation = () => {
    if (!row?.id) return;
    createQuotationMutation.mutate({ rowId: row.id });
  };

  const handleUpdateQuotationField = (
    id: string,
    field: keyof Pick<QuotationState, 'pricingParameterSetId' | 'retailPrice' | 'supplierQuotation' | 'notes' | 'sku'>,
    value: string | number | null
  ) => {
    setQuotations(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const handleBlurQuotation = (id: string, overrides?: Partial<QuotationState>) => {
    const q = quotations.find(q => q.id === id);
    if (!q) return;
    const merged = overrides ? { ...q, ...overrides } : q;
    updateQuotationMutation.mutate({
      quotationId: merged.id,
      data: {
        pricingParameterSetId: merged.pricingParameterSetId,
        retailPrice: merged.retailPrice ?? undefined,
        supplierQuotation: merged.supplierQuotation ?? undefined,
        notes: merged.notes,
        sku: merged.sku,
      },
    });
  };

  const handleDeleteQuotation = (id: string) => {
    deleteQuotationMutation.mutate({ quotationId: id });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-full p-0 gap-0 flex flex-col max-h-[90vh]">
        {/* Fixed header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="text-lg">{title}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Top 3-column section */}
              <div className="grid grid-cols-7 divide-x">
                {/* Left col: Identification (includes group at top) (3/7) */}
                <div className="col-span-3 px-6 py-6">
                  <IdentificationSection
                    control={form.control}
                    canUpdate={canUpdate}
                    availableGenders={availableGenders}
                    groups={groups}
                  />
                </div>

                {/* Center col: Photo + Vendor + Forecast (2/7) */}
                <div className="col-span-2 px-6 py-6 space-y-5">
                  <PictureSidePanel
                    canUpdate={canUpdate}
                    pictureUrl={previewPictureUrl}
                    onRemovePicture={handlePictureRemove}
                    onUploadPicture={handlePictureUpload}
                  />
                  <VendorSection
                    control={form.control}
                    canUpdate={canUpdate}
                  />
                  <div>
                    <SectionHeader title="Forecast" />
                    <div className="mt-3">
                      <ForecastSection control={form.control} canUpdate={canUpdate} />
                    </div>
                  </div>
                </div>

                {/* Right col: Notes (2/7) */}
                <div className="col-span-2 px-6 py-6 flex flex-col">
                  <SectionHeader title="Note" />
                  <div className="flex-1 mt-4 min-h-0">
                    <NotesSection control={form.control} canUpdate={canUpdate} />
                  </div>
                </div>
              </div>

              {/* Pricing footer section */}
              <div className="border-t px-6 py-6">
                <PricingFooterSection
                  control={form.control}
                  canUpdate={canUpdate}
                  mode={mode}
                  quotations={quotations}
                  parameterSets={parameterSets}
                  enabledParameterSetIds={enabledParameterSetIds}
                  onAddQuotation={handleAddQuotation}
                  onUpdateField={handleUpdateQuotationField}
                  onBlurQuotation={handleBlurQuotation}
                  onDeleteQuotation={handleDeleteQuotation}
                  isAddingQuotation={createQuotationMutation.isPending}
                />
              </div>
            </div>

            {/* Fixed footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t shrink-0">
              {/* Exports — left, only in edit mode */}
              <div className="flex items-center gap-2">
                {mode === 'edit' && row?.id && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => exportRowXlsxMutation.mutate({ rowId: row.id })}
                      disabled={exportRowXlsxMutation.isPending}
                    >
                      <Download className="mr-1 h-3 w-3" />
                      XLSX
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => exportRowPdfMutation.mutate({ rowId: row.id })}
                      disabled={exportRowPdfMutation.isPending}
                    >
                      <FileText className="mr-1 h-3 w-3" />
                      PDF
                    </Button>
                  </>
                )}
              </div>
              {/* Actions — right */}
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Annulla
                </Button>
                {canUpdate && (
                  <Button type="submit" disabled={isLoading || isUploadingPicture}>
                    {isUploadingPicture
                      ? 'Upload foto…'
                      : isLoading
                        ? 'Salvataggio…'
                        : mode === 'create'
                          ? 'Crea riga'
                          : 'Salva modifiche'}
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
