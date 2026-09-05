import { useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import type { CollectionLayoutRowInput } from '@luke/core';

import {
  buildDefaultValues,
  buildRowFormValues,
  initialPreviewPictureUrl,
  initialQuotations,
  resolveDefaultGender,
  resolveDefaultGroupId,
  useRowDrawerForm,
  type UseRowDrawerFormResult,
} from '../useRowDrawerForm';

import type { CollectionGroup, CollectionRow, QuotationState } from '../CollectionRowSections';

type HarnessResult = UseRowDrawerFormResult & { form: UseFormReturn<CollectionLayoutRowInput> };

/**
 * Regression test for the real `useRowDrawerForm` production hook (not a reimplementation of it,
 * not a standalone react-hook-form reproduction — this mounts the actual hook, using the actual
 * `react-hook-form` library, and reads its actual `form` instance). No trpc/session/child-dialog
 * mocking is needed because the hook takes plain props, not tRPC queries — that's the whole point
 * of the extraction from `CollectionRowDrawer`.
 *
 * The hook's fixes (phase-note reset timing, picture `shouldDirty`, create-mode late-default
 * merging) were each verified during development by temporarily reverting the corresponding
 * production code and confirming the matching test below fails against it, then reverting the
 * mutation — that evidence lives in the development record, not as a section in this file.
 */

// Only the fields useRowDrawerForm/rowToQuotationState actually read are given real values; the
// rest of CollectionRow's (deep, tRPC-inferred) shape is irrelevant to this hook and cast past —
// see the CollectionGroup/CollectionRow comment below for why a plain literal can't satisfy it.
function makeRow(overrides: Record<string, unknown> = {}): CollectionRow {
  return {
    id: 'row-1',
    groupId: 'group-1',
    planningGroupId: 'pg-1',
    gender: 'MAN',
    vendorId: null,
    line: 'Original Line',
    article: null,
    status: 'NEW',
    skuForecast: 10,
    qtyForecast: 100,
    productCategory: 'Shoes',
    strategy: null,
    styleStatus: null,
    pricePositioning: null,
    phaseId: null,
    designer: null,
    pictureKey: null,
    pictureUrl: null,
    styleNotes: null,
    materialNotes: null,
    colorNotes: null,
    toolingNotes: null,
    toolingQuotation: null,
    completedAt: null,
    quotations: [],
    ...overrides,
    // CollectionRow is inferred from a deep tRPC RouterOutputs conditional type; a plain fixture
    // literal can only ever provide the subset this hook reads, never the full shape, so this
    // cast is unavoidable rather than a shortcut around it.
  } as unknown as CollectionRow;
}

function makeQuotation(overrides: Partial<QuotationState> & { id: string; rowId: string }): QuotationState {
  return {
    order: 0, pricingParameterSetId: null, retailPrice: null, supplierQuotation: null,
    notes: null, sku: null, isNew: true,
    ...overrides,
  };
}

function Harness({
  open,
  mode,
  row,
  defaultGroupId,
  onReady,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  row?: CollectionRow;
  defaultGroupId?: string;
  onReady: (result: HarnessResult) => void;
}) {
  // Deliberately a BRAND NEW array literal on every render, unlike a real caller (which gets
  // these from a React Query result, kept stable by structural sharing) — this is the worst
  // case, and the whole point: the H1 review found that depending on these raw arrays (instead
  // of the resolved scalars below) could turn a fresh-but-equivalent array into an infinite
  // reset loop. Every test in this file rerenders through this harness, so every test doubles
  // as a no-loop regression check; `'fresh-but-equivalent arrays...'` below just names it.
  const groups: CollectionGroup[] = [{ id: 'group-1' } as unknown as CollectionGroup];
  const availableGenders = ['MAN', 'WOMAN'];
  const resolvedGroupId = resolveDefaultGroupId(defaultGroupId, groups);
  const resolvedGender = resolveDefaultGender(availableGenders);

  // Mirrors CollectionRowDrawer: the form instance is created by the consumer (no resolver
  // needed here — these tests never call handleSubmit, only setValue/getValues/reset).
  const form = useForm<CollectionLayoutRowInput>({
    defaultValues: buildDefaultValues(resolvedGroupId, resolvedGender, undefined),
  });
  const result = useRowDrawerForm({
    form,
    open,
    mode,
    row,
    resolvedGroupId,
    resolvedGender,
    defaultPlanningGroupId: undefined,
  });
  onReady({ ...result, form });
  return null;
}

async function mount(props: { open: boolean; mode: 'create' | 'edit'; row?: CollectionRow; defaultGroupId?: string }) {
  let current!: HarnessResult;
  const screen = await render(<Harness {...props} onReady={r => { current = r; }} />);
  return {
    screen,
    get result() { return current; },
    async rerender(next: Partial<typeof props>) {
      await screen.rerender(<Harness {...props} {...next} onReady={r => { current = r; }} />);
    },
  };
}

describe('useRowDrawerForm (production hook) — same row ID, refreshed row object', () => {
  test('a dirty field survives; an untouched field adopts the refreshed value', async () => {
    const rowV1 = makeRow({ line: 'Original Line', qtyForecast: 100 });
    const h = await mount({ open: true, mode: 'edit', row: rowV1 });

    // User edits `line` — react-hook-form marks it dirty.
    h.result.form.setValue('line', 'My WIP edit', { shouldDirty: true });
    expect(h.result.form.getValues('line')).toBe('My WIP edit');

    // Background refresh: same row id, qtyForecast changed server-side, line unchanged server-side.
    const rowV2 = makeRow({ line: 'Original Line', qtyForecast: 150 });
    await h.rerender({ row: rowV2 });

    expect(h.result.form.getValues('line')).toBe('My WIP edit'); // survives
    expect(h.result.form.getValues('qtyForecast')).toBe(150); // adopts refreshed value
  });

  test('phase-change note survives a same-row refresh', async () => {
    const row = makeRow();
    const h = await mount({ open: true, mode: 'edit', row });

    h.result.setPhaseChangeNote('Delayed due to fabric shortage');
    await h.rerender({ row: makeRow({ qtyForecast: 999 }) });

    expect(h.result.phaseChangeNote).toBe('Delayed due to fabric shortage');
  });

  test('a pending picture upload survives a same-row refresh', async () => {
    const row = makeRow({ pictureKey: 'old-key' });
    const h = await mount({ open: true, mode: 'edit', row });

    // Calls the exact production function CollectionRowDrawer's handlePictureUpload calls on
    // its success path — not a hand-simulated setValue, so removing `shouldDirty` from
    // `applyPictureUpload` itself (not from this test) is what the targeted mutation below flips.
    h.result.applyPictureUpload('new-file-object-id');
    h.result.setPreviewPictureUrl('blob:preview');

    await h.rerender({ row: makeRow({ pictureKey: 'old-key', qtyForecast: 42 }) });

    expect(h.result.form.getValues('pendingPictureFileObjectId')).toBe('new-file-object-id');
    expect(h.result.previewPictureUrl).toBe('blob:preview');
  });

  test('an explicit picture removal survives a same-row refresh', async () => {
    const row = makeRow({ pictureKey: 'old-key' });
    const h = await mount({ open: true, mode: 'edit', row });

    // Calls the exact production function CollectionRowDrawer's handlePictureRemove calls.
    h.result.applyPictureRemoval();
    h.result.setPreviewPictureUrl(null);

    // Background refresh still reports the OLD picture — must not resurrect it.
    await h.rerender({ row: makeRow({ pictureKey: 'old-key', qtyForecast: 42 }) });

    expect(h.result.form.getValues('pictureKey')).toBeNull();
    expect(h.result.previewPictureUrl).toBeNull();
  });

  test('quotation draft state is not reset by a same-row refresh', async () => {
    const row = makeRow();
    const h = await mount({ open: true, mode: 'edit', row });

    h.result.setQuotations([makeQuotation({ id: 'q-draft', rowId: 'row-1', notes: 'draft' })]);

    await h.rerender({ row: makeRow({ qtyForecast: 42 }) });

    expect(h.result.quotations).toHaveLength(1);
    expect(h.result.quotations[0].notes).toBe('draft');
  });
});

describe('useRowDrawerForm (production hook) — different row, or close/reopen', () => {
  test('a different row id fully initializes the form, leaking nothing from the previous session', async () => {
    const rowA = makeRow({ id: 'row-A', line: 'Row A', pictureKey: 'a-key' });
    const h = await mount({ open: true, mode: 'edit', row: rowA });

    h.result.form.setValue('line', 'unsaved edit on row A', { shouldDirty: true });
    h.result.setPhaseChangeNote('note on row A');
    h.result.setPreviewPictureUrl('blob:row-a-preview');
    h.result.setQuotations([makeQuotation({ id: 'q1', rowId: 'row-A' })]);

    const rowB = makeRow({ id: 'row-B', line: 'Row B', pictureKey: null, pictureUrl: 'https://example.test/b.jpg' });
    await h.rerender({ row: rowB });

    expect(h.result.form.getValues('line')).toBe('Row B');
    expect(h.result.phaseChangeNote).toBe('');
    expect(h.result.previewPictureUrl).toBe('https://example.test/b.jpg');
    expect(h.result.quotations).toHaveLength(0);
  });

  test('close then reopen the same row starts a fresh session (no leaked draft)', async () => {
    const row = makeRow({ id: 'row-1', line: 'Original' });
    const h = await mount({ open: true, mode: 'edit', row });

    h.result.form.setValue('line', 'unsaved edit', { shouldDirty: true });
    h.result.setPhaseChangeNote('leftover note');

    await h.rerender({ open: false });
    await h.rerender({ open: true, row });

    expect(h.result.form.getValues('line')).toBe('Original');
    expect(h.result.phaseChangeNote).toBe('');
  });
});

describe('useRowDrawerForm (production hook) — create mode', () => {
  test('late-arriving defaults populate untouched fields without overwriting edited ones', async () => {
    const h = await mount({ open: true, mode: 'create', row: undefined, defaultGroupId: undefined });

    // User starts typing before the group query resolves.
    h.result.form.setValue('line', 'New Style', { shouldDirty: true });
    expect(h.result.form.getValues('groupId')).toBe('group-1'); // from the harness's groups[0] fallback

    // Defaults arrive late (e.g. defaultGroupId resolves from a slower query).
    await h.rerender({ defaultGroupId: 'late-group-id' });

    expect(h.result.form.getValues('groupId')).toBe('late-group-id'); // untouched field adopts it
    expect(h.result.form.getValues('line')).toBe('New Style'); // edited field preserved
  });

  test('reopening a create session starts cleanly', async () => {
    const h = await mount({ open: true, mode: 'create', row: undefined });
    h.result.form.setValue('line', 'unsaved draft', { shouldDirty: true });

    await h.rerender({ open: false });
    await h.rerender({ open: true });

    expect(h.result.form.getValues('line')).toBe('');
  });
});

describe('useRowDrawerForm (production hook) — resolved-scalar dependency, not raw array identity', () => {
  test('fresh-but-equivalent groups/availableGenders arrays on every render cause no reset loop and no draft loss', async () => {
    // The harness (see above) already passes a brand-new array literal on every single render —
    // this test just names the invariant and exercises it explicitly across many rerenders and
    // both modes. A real dependency-on-raw-arrays regression would hang or crash this test
    // (React's "Maximum update depth exceeded") rather than fail a plain assertion — completing
    // at all, on top of the assertions below, is part of what this proves.
    const row = makeRow({ line: 'Original Line' });
    const h = await mount({ open: true, mode: 'edit', row });
    h.result.form.setValue('line', 'my in-progress edit', { shouldDirty: true });

    for (let i = 0; i < 5; i++) {
      await h.rerender({ row });
    }
    expect(h.result.form.getValues('line')).toBe('my in-progress edit');

    // Same check in create mode, where the resolved scalars (not the arrays) are what feed
    // `buildDefaultValues` on every one of these same-session rerenders.
    const c = await mount({ open: true, mode: 'create' });
    c.result.form.setValue('line', 'my draft new row', { shouldDirty: true });

    for (let i = 0; i < 5; i++) {
      await c.rerender({ mode: 'create' });
    }
    expect(c.result.form.getValues('line')).toBe('my draft new row');
  });
});

describe('buildRowFormValues / initialPreviewPictureUrl / initialQuotations — mount-time correctness', () => {
  // These three plain functions are what `CollectionRowDrawer` uses as `useForm()`'s initial
  // `defaultValues` and as this hook's `useState` lazy initializers — i.e. exactly what a freshly
  // mounted session's FIRST render is built from, before `useRowDrawerForm`'s effect ever runs.
  // The parent (`page.tsx`'s `openRowDrawer`) is what guarantees a new session IS a fresh mount;
  // what these functions prove is that a fresh mount's first render is already correct — the two
  // together are the fix for a first frame that used to combine the new row's header with the
  // previous row's leftover form/picture/quotation state. Plain function calls rather than a
  // render assertion on purpose: by the time a `render()` in this file resolves, its effects have
  // already flushed too, so a DOM assertion at that point can't tell "correct from the start" apart
  // from "corrected by the effect a tick later" — these calls can.

  test('buildRowFormValues returns the row\'s own data in edit mode, not blank create defaults', () => {
    const row = makeRow({ line: 'Existing Row', qtyForecast: 77, groupId: 'group-9' });
    const values = buildRowFormValues('edit', row, 'group-1', 'MAN', undefined);

    expect(values.line).toBe('Existing Row');
    expect(values.qtyForecast).toBe(77);
    expect(values.groupId).toBe('group-9'); // the row's own groupId, not the resolvedGroupId fallback
  });

  test('buildRowFormValues falls back to create-mode defaults for create mode or a missing row', () => {
    const values = buildRowFormValues('create', undefined, 'group-1', 'WOMAN', 'pg-1');

    expect(values.line).toBe('');
    expect(values.groupId).toBe('group-1');
    expect(values.gender).toBe('WOMAN');
    expect(values.planningGroupId).toBe('pg-1');
  });

  test('initialPreviewPictureUrl/initialQuotations reflect the row immediately in edit mode', () => {
    const row = makeRow({
      pictureUrl: 'https://example.test/row.jpg',
      quotations: [makeQuotation({ id: 'q1', rowId: 'row-1', notes: 'from server', isNew: false })],
    });

    expect(initialPreviewPictureUrl('edit', row)).toBe('https://example.test/row.jpg');
    const quotations = initialQuotations('edit', row);
    expect(quotations).toHaveLength(1);
    expect(quotations[0]?.notes).toBe('from server');
    expect(quotations[0]?.isNew).toBe(false); // reconciled from the server, never treated as a new draft row
  });

  test('initialPreviewPictureUrl/initialQuotations start blank in create mode — nothing leaks from a previous row', () => {
    expect(initialPreviewPictureUrl('create', undefined)).toBeNull();
    expect(initialQuotations('create', undefined)).toEqual([]);
  });
});
