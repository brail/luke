'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Download, FileText } from 'lucide-react';
import { useSession } from 'next-auth/react';
import React, { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  CollectionLayoutRowInputSchema,
  type CollectionLayoutRowInput,
  buildCollectionRowPictureUploadUrl,
  buildTempCollectionRowPictureUploadUrl,
} from '@luke/core';

import { ConfirmDialog } from '../../../../../components/ConfirmDialog';
import { LastModifiedBy } from '../../../../../components/LastModifiedBy';
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

import { ChangePhaseDialog } from './ChangePhaseDialog';
import { ChangePlanningGroupDialog } from './ChangePlanningGroupDialog';
import {
  ForecastSection,
  IdentificationSection,
  NotesSection,
  PictureSidePanel,
  PlanningSection,
  PricingFooterSection,
  SectionHeader,
  VendorSection,
  type CollectionGroup,
  type CollectionRow,
  type PricingParameterSet,
  type QuotationState,
} from './CollectionRowSections';
import { buildRowFormValues, resolveDefaultGender, resolveDefaultGroupId, useRowDrawerForm } from './useRowDrawerForm';

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
  brandId: string;
  seasonId: string;
  onSubmit: (data: CollectionLayoutRowInput) => void;
  onPictureUploaded?: () => void;
  /** Called after the row is concluded or reopened — that write lands immediately, outside the
   * drawer's buffered save, so the layout and alert queries need refetching right away. */
  onCompletionChanged: () => void;
  isLoading?: boolean;
  canUpdate?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function missingForecastLabels(data: CollectionLayoutRowInput): string[] {
  const missing: string[] = [];
  if (data.skuForecast == null) missing.push('SKU Forecast');
  if (data.qtyForecast == null) missing.push('Qty Forecast');
  return missing;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Slide-over drawer for creating or editing a collection row.
 *
 * Orchestrates the form (via react-hook-form + `CollectionLayoutRowInputSchema`),
 * picture upload (temp-path → confirm on save), and inline quotation management.
 * Sections are rendered by `CollectionRowSections` sub-components.
 *
 * @param mode - "create" shows empty defaults; "edit" pre-fills from `row`.
 * @param row - Existing row to edit; omit in create mode.
 * @param defaultGroupId - Group pre-selected when creating a new row.
 * @param groups - All groups in the layout (used in the group selector).
 * @param parameterSets - Available pricing parameter sets for quotations.
 * @param availableGenders - Genders enabled for this layout (e.g. ['MAN','WOMAN']).
 * @param onPictureUploaded - Called after a picture is confirmed server-side.
 * @param onCompletionChanged - Called after the row is concluded or reopened.
 */
export function CollectionRowDrawer({
  open,
  onOpenChange,
  mode,
  row,
  defaultGroupId,
  groups,
  parameterSets,
  availableGenders,
  brandId,
  seasonId,
  onSubmit,
  onPictureUploaded,
  onCompletionChanged,
  isLoading = false,
  canUpdate = true,
}: CollectionRowDrawerProps) {
  const [isUploadingPicture, setIsUploadingPicture] = useState(false);
  const [pendingData, setPendingData] = useState<CollectionLayoutRowInput | null>(null);
  const [changeGroupOpen, setChangeGroupOpen] = useState(false);
  const [changePhaseOpen, setChangePhaseOpen] = useState(false);
  const { data: session } = useSession();

  const { data: vendorsList } = trpc.vendors.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const { data: planningGroups = [], isLoading: planningGroupsLoading } = trpc.planningGroup.list.useQuery(
    { brandId, seasonId },
    { enabled: open }
  );
  const defaultPlanningGroupId = planningGroups[0]?.id;
  const resolvedGroupId = resolveDefaultGroupId(defaultGroupId, groups);
  const resolvedGender = resolveDefaultGender(availableGenders);

  // `useForm()` only ever reads `defaultValues` at this component instance's first render — the
  // parent (`page.tsx`) keys `CollectionRowDrawer` on `rowDrawerKey` (bumped by `openRowDrawer`)
  // so a new editing session (a different row, or a close/reopen) is always a fresh mount, and
  // `buildRowFormValues` gives that first render the actual row's data (or fresh create defaults)
  // directly, instead of blank fields that only get corrected once `useRowDrawerForm`'s effect
  // runs after paint.
  const form = useForm<CollectionLayoutRowInput>({
    resolver: zodResolver(CollectionLayoutRowInputSchema),
    defaultValues: buildRowFormValues(mode, row, resolvedGroupId, resolvedGender, defaultPlanningGroupId),
  });

  const {
    previewPictureUrl,
    setPreviewPictureUrl,
    quotations,
    setQuotations,
    phaseChangeNote,
    setPhaseChangeNote,
    applyPictureUpload,
    applyPictureRemoval,
  } = useRowDrawerForm({ form, open, mode, row, resolvedGroupId, resolvedGender, defaultPlanningGroupId });

  const currentVendorId = form.watch('vendorId');
  const currentPhaseId = form.watch('phaseId');
  const enabledParameterSetIds = useMemo(
    () => vendorsList?.items.find(v => v.id === currentVendorId)?.enabledParameterSets.map(p => p.id) ?? [],
    [currentVendorId, vendorsList?.items]
  );

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
      applyPictureUpload(result.fileObjectId);
      onPictureUploaded?.();
    } catch (err: unknown) {
      URL.revokeObjectURL(blobUrl);
      setPreviewPictureUrl(null);
      applyPictureUpload(null);
      toast.error(err instanceof Error ? err.message : 'Errore durante upload foto');
    } finally {
      setIsUploadingPicture(false);
    }
  };

  const handlePictureRemove = () => {
    applyPictureRemoval();
    setPreviewPictureUrl(null);
  };

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

  // ─── Quotation handlers — tutti locali, nessuna mutation di rete: bufferizzano su `quotations`,
  // il commit reale avviene al Salva (submitRow → onSubmit → collectionLayout.rows.update/create,
  // che sincronizza le quotazioni nella stessa transazione della riga) ─────────────────
  const handleAddQuotation = () => {
    if (!row?.id) return;
    setQuotations(prev => [...prev, {
      // crypto.randomUUID() requires a secure context (HTTPS or localhost) — falls back
      // to a non-crypto random id over plain HTTP (e.g. an internal http:// hostname).
      id: crypto.randomUUID?.() || Math.random().toString(36).substring(2) + Date.now().toString(36),
      rowId: row.id,
      order: prev.length,
      pricingParameterSetId: null,
      retailPrice: null,
      supplierQuotation: null,
      notes: null,
      sku: null,
      isNew: true,
    }]);
  };

  const handleUpdateQuotationField = (
    id: string,
    field: keyof Pick<QuotationState, 'pricingParameterSetId' | 'retailPrice' | 'supplierQuotation' | 'notes' | 'sku'>,
    value: string | number | null
  ) => {
    setQuotations(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const handleDeleteQuotation = (id: string) => {
    setQuotations(prev => prev.filter(q => q.id !== id));
  };

  const submitRow = form.handleSubmit(data => {
    const payload: CollectionLayoutRowInput = {
      ...data,
      quotations: quotations.map(q => ({
        id: q.isNew ? undefined : q.id,
        pricingParameterSetId: q.pricingParameterSetId,
        retailPrice: q.retailPrice ?? undefined,
        supplierQuotation: q.supplierQuotation ?? undefined,
        notes: q.notes,
        sku: q.sku,
      })),
      phaseChangeNote: phaseChangeNote || undefined,
    };
    if (missingForecastLabels(payload).length > 0) { setPendingData(payload); return; }
    onSubmit(payload);
  });

  const missingLabels = pendingData ? missingForecastLabels(pendingData) : [];

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // vh: no Tailwind scale equivalent for viewport-relative height
        className="max-w-7xl w-full p-0 gap-0 flex flex-col max-h-[90vh]"
      >
        {/* Fixed header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="text-lg">{title}</DialogTitle>
          {mode === 'edit' && row?.id && (
            <LastModifiedBy targetType="CollectionLayoutRow" targetId={row.id} />
          )}
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={submitRow} className="flex flex-col flex-1 min-h-0">
            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Planning band — full width above the identity grid */}
              <div className="border-b px-6 py-5">
                <PlanningSection
                  control={form.control}
                  canUpdate={canUpdate}
                  planningGroups={planningGroups}
                  mode={mode}
                  onRequestChangePlanningGroup={() => setChangeGroupOpen(true)}
                  onRequestChangePhase={() => setChangePhaseOpen(true)}
                  rowId={mode === 'edit' ? row?.id : undefined}
                  completedAt={row?.completedAt ?? null}
                  onCompletionChanged={onCompletionChanged}
                />
              </div>

              {/* Top 3-column section */}
              <div className="grid grid-cols-7 divide-x">
                {/* Left col: Identity (includes group at top) (3/7) */}
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
                  onEnterQuotation={submitRow}
                  onDeleteQuotation={handleDeleteQuotation}
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

    <ConfirmDialog
      open={pendingData != null}
      onOpenChange={open => { if (!open) setPendingData(null); }}
      title={
        missingLabels.length > 1
          ? 'Forecast non impostati'
          : `${missingLabels[0] ?? ''} non impostato`
      }
      description={`Stai salvando una riga senza ${missingLabels.join(' e ')}. Questi valori sono necessari per i calcoli di budget del gruppo e di efficienza. Vuoi procedere senza impostarli?`}
      confirmText="Salva comunque"
      cancelText="Annulla"
      actionType="warning"
      onConfirm={() => { if (pendingData) { onSubmit(pendingData); setPendingData(null); } }}
      isLoading={isLoading}
    />

    {mode === 'edit' && row && (
      <ChangePlanningGroupDialog
        open={changeGroupOpen}
        onClose={() => setChangeGroupOpen(false)}
        onChanged={newPlanningGroupId => {
          setChangeGroupOpen(false);
          form.setValue('planningGroupId', newPlanningGroupId, { shouldDirty: true });
        }}
        planningGroups={planningGroups}
        isLoading={planningGroupsLoading}
      />
    )}

    {mode === 'edit' && row && (
      <ChangePhaseDialog
        open={changePhaseOpen}
        onClose={() => setChangePhaseOpen(false)}
        onChanged={(newPhaseId, note) => {
          setChangePhaseOpen(false);
          form.setValue('phaseId', newPhaseId, { shouldDirty: true });
          if (note) setPhaseChangeNote(note);
        }}
        currentPhaseId={currentPhaseId ?? null}
      />
    )}
    </>
  );
}
