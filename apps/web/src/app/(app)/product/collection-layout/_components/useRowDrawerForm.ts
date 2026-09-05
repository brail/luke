import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { CollectionLayoutRowInput } from '@luke/core';

import type { CollectionGroup, CollectionRow, QuotationState } from './CollectionRowSections';
import type { UseFormReturn } from 'react-hook-form';

/** Resolves the group a new row defaults into: an explicit choice, else the layout's first group. */
export function resolveDefaultGroupId(defaultGroupId: string | undefined, groups: CollectionGroup[]): string {
  return defaultGroupId ?? groups[0]?.id ?? '';
}

/** Resolves the gender a new row defaults into: the layout's first enabled gender. */
export function resolveDefaultGender(availableGenders: string[]): string {
  return availableGenders[0] ?? 'MAN';
}

export function buildDefaultValues(
  groupId: string,
  gender: string,
  defaultPlanningGroupId?: string
): CollectionLayoutRowInput {
  return {
    groupId,
    planningGroupId: defaultPlanningGroupId,
    gender,
    vendorId: null,
    line: '',
    article: null,
    status: 'NEW',
    skuForecast: 1,
    qtyForecast: null,
    productCategory: '',
    strategy: null,
    styleStatus: null,
    phaseId: null,
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
    isNew: false,
  };
}

/**
 * The full set of form values for a row-drawer session: `row` reshaped for edit mode, or fresh
 * create-mode defaults. One source of truth used both as `useForm()`'s initial `defaultValues`
 * (so a freshly *mounted* session's first render already shows the right data — `page.tsx`'s
 * `openRowDrawer` is what forces that fresh mount, by keying `CollectionRowDrawer` on a counter it
 * bumps) and by this hook's own reconciliation effect (for the "row's data refreshed, merge into
 * untouched fields" case) — instead of the same edit/create branch written out twice, one of them
 * a render-cycle late.
 */
export function buildRowFormValues(
  mode: 'create' | 'edit',
  row: CollectionRow | undefined,
  resolvedGroupId: string,
  resolvedGender: string,
  defaultPlanningGroupId: string | undefined
): CollectionLayoutRowInput {
  if (mode === 'edit' && row) {
    return {
      groupId: row.groupId,
      planningGroupId: row.planningGroupId,
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
      pricePositioning: row.pricePositioning ?? null,
      phaseId: row.phaseId ?? null,
      designer: row.designer ?? null,
      pictureKey: row.pictureKey ?? null,
      pendingPictureFileObjectId: null,
      styleNotes: row.styleNotes ?? null,
      materialNotes: row.materialNotes ?? null,
      colorNotes: row.colorNotes ?? null,
      toolingNotes: row.toolingNotes ?? null,
      toolingQuotation: row.toolingQuotation ?? null,
    };
  }
  return buildDefaultValues(resolvedGroupId, resolvedGender, defaultPlanningGroupId);
}

/** The picture preview a freshly mounted session should start with — `row`'s current picture in
 * edit mode, none in create mode. Exported (alongside `initialQuotations`) so the "correct on the
 * very first render, before any effect" claim is a plain, deterministic function call to test,
 * not something that has to be caught mid-flight in a live render. */
export function initialPreviewPictureUrl(mode: 'create' | 'edit', row: CollectionRow | undefined): string | null {
  return mode === 'edit' && row ? (row.pictureUrl ?? null) : null;
}

/** The quotations a freshly mounted session should start with — see `initialPreviewPictureUrl`. */
export function initialQuotations(mode: 'create' | 'edit', row: CollectionRow | undefined): QuotationState[] {
  return mode === 'edit' && row ? (row.quotations ?? []).map(rowToQuotationState) : [];
}

export interface UseRowDrawerFormParams {
  form: UseFormReturn<CollectionLayoutRowInput>;
  open: boolean;
  mode: 'create' | 'edit';
  row?: CollectionRow;
  /**
   * The create-mode defaults, already resolved to scalars by the caller (`resolveDefaultGroupId`/
   * `resolveDefaultGender`) rather than passed as the raw `groups`/`availableGenders` arrays.
   * The synchronization effect below re-fires whenever a value it depends on changes reference,
   * and an array is a new reference on every render unless something upstream memoizes it — a
   * plain scalar string only changes when its actual value does, which is what this effect
   * needs: a real prop change, not an incidental re-render of whatever list it came from.
   */
  resolvedGroupId: string;
  resolvedGender: string;
  defaultPlanningGroupId?: string;
}

export interface UseRowDrawerFormResult {
  previewPictureUrl: string | null;
  setPreviewPictureUrl: (url: string | null) => void;
  quotations: QuotationState[];
  setQuotations: Dispatch<SetStateAction<QuotationState[]>>;
  phaseChangeNote: string;
  setPhaseChangeNote: (note: string) => void;
  /**
   * Records a picture upload's outcome on the form: `fileObjectId` on success, `null` on failure
   * (rolling back to "no pending upload"). Marks the field dirty so a same-session background
   * refresh (see this hook's own doc comment) preserves it instead of silently reverting it to
   * the server value.
   */
  applyPictureUpload: (fileObjectId: string | null) => void;
  /** Clears both picture fields for an explicit user removal, dirty for the same reason above. */
  applyPictureRemoval: () => void;
}

/**
 * Reconciles the caller's form instance (created by `CollectionRowDrawer` via `useForm()`, not by
 * this hook) against `row` on every relevant change.
 *
 * `row` is deliberately live-derived by the parent page (re-resolved from the layout query on
 * every render, not a frozen snapshot — see the `rowDrawer` state comment in `page.tsx`), so this
 * effect can fire for two structurally different reasons that must be handled differently:
 *
 * - **a new editing session** (a different row, switching create/edit, or reopening after close):
 *   the parent keys `CollectionRowDrawer` on a counter `openRowDrawer` bumps, specifically so this
 *   is a fresh *mount*, not a prop change on a surviving instance — `useForm()`'s `defaultValues`
 *   (built from `buildRowFormValues`) and this hook's own `useState` initial values (`initialPreviewPictureUrl`/
 *   `initialQuotations`) already hold the new session's real data on the very first render, so
 *   there's no frame where the new row's header (read straight from the `row` prop, always fresh)
 *   is showing next to the previous row's leftover form/picture/quotation state. This effect still
 *   runs once right after that first render (a fresh mount is itself a "relevant change"), but by
 *   then the values it computes already match what mount-time initialization produced — a
 *   redundant, harmless `form.reset()` to the same values, not a visible correction.
 * - **the same row's live data just refreshed** (a completion-tracking write from elsewhere, a
 *   background revalidation, of the SAME mounted session): `form.reset(values, { keepDirtyValues:
 *   true })` adopts the refreshed value only for fields the user hasn't touched, preserving
 *   whatever they're mid-editing. The picture preview, quotations and phase-change note — none of
 *   them react-hook-form fields — are simply left untouched here, which is what preserves them.
 *
 * For `keepDirtyValues` to protect a field, react-hook-form has to consider it dirty, which only
 * happens for a `setValue` call made with `{ shouldDirty: true }` — every *programmatic* write to
 * a form field (picture upload/removal; the same pattern the existing group/phase-change dialogs
 * already follow via their own `setValue(..., { shouldDirty: true })` calls) needs that flag, or a
 * same-session refresh would silently revert it to the server value while the surrounding UI still
 * shows the user's edit. `applyPictureUpload`/`applyPictureRemoval` below own that flag for the
 * picture fields so the caller can't add a new picture-mutating call site that forgets it.
 */
export function useRowDrawerForm({
  form,
  open,
  mode,
  row,
  resolvedGroupId,
  resolvedGender,
  defaultPlanningGroupId,
}: UseRowDrawerFormParams): UseRowDrawerFormResult {
  const [previewPictureUrl, setPreviewPictureUrl] = useState<string | null>(() => initialPreviewPictureUrl(mode, row));
  const [quotations, setQuotations] = useState<QuotationState[]>(() => initialQuotations(mode, row));
  const [phaseChangeNote, setPhaseChangeNote] = useState('');

  // Tracks sessions across *renders* of one hook instance — belt-and-suspenders for a caller that
  // doesn't remount on a new session (the mount-time initial state above already gets this right
  // for the real `CollectionRowDrawer`, which the parent keys on `openRowDrawer`'s counter
  // precisely so every new session IS a remount; this ref keeps the same guarantee for any other
  // caller).
  const editSessionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      // No need to clear preview/note/quotations here: closing always makes
      // `editSessionKeyRef.current` stale for whatever opens next (a real session key is never
      // `null`), so the "new session" branch below unconditionally re-initializes everything the
      // next time the drawer opens, before anything is shown. Clearing on close would just be
      // resetting state the render output can't see anyway (the drawer is hidden), which is the
      // "you might not need an effect for this" case react-hooks/set-state-in-effect flags.
      editSessionKeyRef.current = null;
      return;
    }
    const sessionKey = `${mode}:${row?.id ?? 'new'}`;
    const isNewSession = editSessionKeyRef.current !== sessionKey;
    editSessionKeyRef.current = sessionKey;
    if (isNewSession) {
      setPhaseChangeNote('');
    }

    form.reset(
      buildRowFormValues(mode, row, resolvedGroupId, resolvedGender, defaultPlanningGroupId),
      // New session: full reset. Same session (row/defaults just refreshed): keep whatever the
      // user is mid-editing, adopt the live value only for fields they haven't touched.
      isNewSession ? undefined : { keepDirtyValues: true }
    );
    if (isNewSession) {
      setPreviewPictureUrl(initialPreviewPictureUrl(mode, row));
      setQuotations(initialQuotations(mode, row));
    }
  }, [open, mode, row, resolvedGroupId, resolvedGender, defaultPlanningGroupId, form]);

  const applyPictureUpload = useCallback((fileObjectId: string | null) => {
    form.setValue('pendingPictureFileObjectId', fileObjectId, { shouldDirty: true });
  }, [form]);

  const applyPictureRemoval = useCallback(() => {
    form.setValue('pictureKey', null, { shouldDirty: true });
    form.setValue('pendingPictureFileObjectId', null, { shouldDirty: true });
  }, [form]);

  return {
    previewPictureUrl,
    setPreviewPictureUrl,
    quotations,
    setQuotations,
    phaseChangeNote,
    setPhaseChangeNote,
    applyPictureUpload,
    applyPictureRemoval,
  };
}
