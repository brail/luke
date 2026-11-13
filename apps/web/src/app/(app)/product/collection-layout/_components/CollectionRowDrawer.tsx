'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft, ChevronRight, Download, FileText } from 'lucide-react';
import { useSession } from 'next-auth/react';
import React, { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import {
  CollectionLayoutRowInputSchema,
  type CollectionGender,
  type CollectionLayoutRowInput,
  buildCollectionRowPictureUploadUrl,
  buildTempCollectionRowPictureUploadUrl,
} from '@luke/core';

import { ChoiceDialog } from '../../../../../components/ChoiceDialog';
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
import {
  buildRowFormValues,
  enabledParameterSetIdsFor,
  resolveDefaultGender,
  resolveDefaultGroupId,
  useRowDrawerForm,
} from './useRowDrawerForm';

import type { VendorListItem } from './VendorCombobox';

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
  availableGenders: CollectionGender[];
  brandId: string;
  seasonId: string;
  /** Saves the row, then opens `nextRowId` when given, or closes the drawer. */
  onSubmit: (data: CollectionLayoutRowInput, nextRowId?: string) => void;
  /** Where the row stands in the board's filtered, sorted rows (#55); absent for a new row. */
  navigation?: RowNavigation;
  /** Opens another row of the board in the drawer. */
  onNavigate?: (rowId: string) => void;
  onPictureUploaded?: () => void;
  /** Called after the row is concluded or reopened — that write lands immediately, outside the
   * drawer's buffered save, so the layout and alert queries need refetching right away. */
  onCompletionChanged: () => void;
  isLoading?: boolean;
  canUpdate?: boolean;
}

export interface RowNavigation {
  /** 1-based. */
  position: number;
  total: number;
  previousRowId: string | null;
  nextRowId: string | null;
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
 * @param navigation - Previous/next rows, reachable by buttons and `Alt+↑`/`Alt+↓`; leaving a row
 *   with unsaved changes — by navigating or by closing — asks to save, discard or stay.
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
  navigation,
  onNavigate,
  onPictureUploaded,
  onCompletionChanged,
  isLoading = false,
  canUpdate = true,
}: CollectionRowDrawerProps) {
  const [isUploadingPicture, setIsUploadingPicture] = useState(false);
  // A save that waits for the missing-forecast confirmation, with the row to open after it.
  const [pendingData, setPendingData] = useState<{ payload: CollectionLayoutRowInput; nextRowId?: string } | null>(null);
  // Quotations live outside the form, so its dirty state does not see them.
  const [quotationsEdited, setQuotationsEdited] = useState(false);
  // Leaving the row with unsaved changes: the row to open, or `null` to close the drawer.
  const [leaving, setLeaving] = useState<{ to: string | null } | null>(null);
  const [changeGroupOpen, setChangeGroupOpen] = useState(false);
  const [changePhaseOpen, setChangePhaseOpen] = useState(false);
  const { data: session } = useSession();

  const [pickedVendor, setPickedVendor] = useState<VendorListItem | null>(null);
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
    () => enabledParameterSetIdsFor(currentVendorId, [pickedVendor, row?.vendor]),
    [currentVendorId, pickedVendor, row?.vendor]
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

  // ─── Quotation handlers — all local, no network mutation: they buffer into `quotations`,
  // the real commit happens on Save (saveRow → onSubmit → collectionLayout.rows.update/create,
  // which syncs the quotations in the same transaction as the row) ─────────────────
  const editQuotations: typeof setQuotations = update => {
    setQuotations(update);
    setQuotationsEdited(true);
  };

  const handleAddQuotation = () => {
    if (!row?.id) return;
    editQuotations(prev => [...prev, {
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
    editQuotations(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const handleDeleteQuotation = (id: string) => {
    editQuotations(prev => prev.filter(q => q.id !== id));
  };

  const saveRow = (nextRowId?: string) => form.handleSubmit(data => {
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
    if (missingForecastLabels(payload).length > 0) { setPendingData({ payload, nextRowId }); return; }
    onSubmit(payload, nextRowId);
  });

  const missingLabels = pendingData ? missingForecastLabels(pendingData.payload) : [];

  // ─── Leaving the row: navigation and close ────────────────────────
  const isDirty = canUpdate && (form.formState.isDirty || quotationsEdited);
  const isBusy = isLoading || isUploadingPicture;
  const goTo = (to: string | null) => (to ? onNavigate?.(to) : onOpenChange(false));
  // Not while a save or a picture upload runs: its outcome belongs to this row.
  const leave = (to: string | null) => {
    if (isBusy) return;
    if (isDirty) setLeaving({ to });
    else goTo(to);
  };
  const navigateTo = (to: string | null) => { if (to) leave(to); };
  const handleNavigationKey = (e: React.KeyboardEvent) => {
    if (!navigation || !e.altKey || e.shiftKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    // A multi-line text moves its caret on ⌥↑/↓ (macOS), a combobox opens its list on Alt+↓.
    if (e.target instanceof Element && e.target.closest('textarea, [role="combobox"], [role="listbox"]')) return;
    e.preventDefault();
    navigateTo(e.key === 'ArrowUp' ? navigation.previousRowId : navigation.nextRowId);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={next => (next ? onOpenChange(true) : leave(null))}>
      <DialogContent
        onKeyDown={handleNavigationKey}
        // vh: no Tailwind scale equivalent for viewport-relative height
        className="max-w-7xl w-full p-0 gap-0 flex flex-col max-h-[90vh]"
      >
        {/* Fixed header */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center justify-between gap-4 pr-8">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            {navigation && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Button
                  type="button" variant="outline" size="sm" aria-keyshortcuts="Alt+ArrowUp"
                  onClick={() => navigateTo(navigation.previousRowId)}
                  disabled={!navigation.previousRowId || isBusy}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Precedente
                </Button>
                <span className="tabular-nums">{navigation.position} di {navigation.total}</span>
                <span className="text-xs">Alt+↑/↓</span>
                <Button
                  type="button" variant="outline" size="sm" aria-keyshortcuts="Alt+ArrowDown"
                  onClick={() => navigateTo(navigation.nextRowId)}
                  disabled={!navigation.nextRowId || isBusy}
                >
                  Successiva
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          {mode === 'edit' && row?.id && (
            <LastModifiedBy targetType="CollectionLayoutRow" targetId={row.id} />
          )}
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={saveRow()} className="flex flex-col flex-1 min-h-0">
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
                    vendor={row?.vendor ?? null}
                    onVendorPicked={setPickedVendor}
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
                  onEnterQuotation={saveRow()}
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
                <Button type="button" variant="outline" onClick={() => leave(null)}>
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
      onConfirm={() => { if (pendingData) { onSubmit(pendingData.payload, pendingData.nextRowId); setPendingData(null); } }}
      isLoading={isLoading}
    />

    <ChoiceDialog
      open={leaving != null}
      onOpenChange={next => { if (!next) setLeaving(null); }}
      title="Modifiche non salvate"
      description={leaving?.to
        ? "La riga ha modifiche non salvate. Vuoi salvarle prima di passare a un'altra riga?"
        : 'La riga ha modifiche non salvate. Vuoi salvarle prima di chiudere?'}
      cancelText="Resta"
      secondaryText="Scarta"
      onSecondary={() => goTo(leaving?.to ?? null)}
      primaryText="Salva"
      onPrimary={() => void saveRow(leaving?.to ?? undefined)()}
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
        currentPlanningGroupId={form.watch('planningGroupId')}
        saved={{ rowId: row.id, phaseId: row.phaseId, planningGroupId: row.planningGroupId }}
      />
    )}
    </>
  );
}
