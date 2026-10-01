import { describe, expect, it, vi } from 'vitest';

import { childSectionsOf } from '@luke/core';

import {
  applyEdits,
  editsBetween,
  isSectionLocked,
  isSectionOverridden,
  resetEditsToRoleDefaults,
  resetSection,
  sectionRows,
  sendableEdits,
  toggleSection,
  withoutReflected,
} from '../sectionTree';

/** A role that has nothing by default, like a viewer on `admin`. */
const nothing = () => false;
/** A role that has everything by default, like an admin. */
const everything = () => true;

describe('sectionTree — switches', () => {
  it('lists each root followed by its children, so a late enum entry lands in its group', () => {
    const rows = sectionRows();
    const settings = rows.indexOf('settings');
    // `settings.company` sits at the end of `sectionEnum`; it must render under Settings.
    expect(rows.slice(settings + 1, settings + 1 + childSectionsOf('settings').length)).toContain(
      'settings.company'
    );
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('turns every child on when a parent is switched on', () => {
    const next = toggleSection({}, 'admin', true, nothing, []);
    for (const child of childSectionsOf('admin')) expect(next[child]).toBe(true);
    expect('admin' in next).toBe(false);
  });

  it('turns every child off when a parent is switched off', () => {
    const next = toggleSection({}, 'admin', false, everything, []);
    for (const child of childSectionsOf('admin')) expect(next[child]).toBe(false);
  });

  it('drops an override that equals the role default instead of storing it', () => {
    expect(toggleSection({}, 'admin.brands', false, nothing, [])).toEqual({});
  });

  it('locks a section only when the kill switch covers every leaf under it', () => {
    expect(isSectionLocked('admin.brands', ['admin'])).toBe(true);
    expect(isSectionLocked('admin', [...childSectionsOf('admin')])).toBe(true);
    expect(isSectionLocked('admin', ['admin.brands'])).toBe(false);
  });

  it('leaves the override of a killed child alone when its parent is switched', () => {
    const killed = ['admin.brands'];
    // Switching the parent on must not plant an override the dialog shows as off and locked.
    expect(toggleSection({}, 'admin', true, nothing, killed)['admin.brands']).toBeUndefined();
    // Nor overwrite one that is already stored.
    expect(toggleSection({ 'admin.brands': false }, 'admin', true, nothing, killed)['admin.brands']).toBe(false);
  });

  it('leaves the override of a killed child alone when its parent is reset', () => {
    const overrides = { 'admin.brands': true, 'admin.seasons': true };
    expect(resetSection(overrides, 'admin', ['admin.brands'])).toEqual({ 'admin.brands': true });
  });

  it('does not show a parent as overridden for an override on a killed child', () => {
    expect(isSectionOverridden('admin', { 'admin.brands': true }, ['admin.brands'])).toBe(false);
    expect(isSectionOverridden('admin', { 'admin.brands': true }, [])).toBe(true);
  });
});

describe('sectionTree — edits over the server state', () => {
  it('shows the server overrides with the edits over them, null removing one', () => {
    expect(applyEdits({ 'admin.brands': true, 'sales.statistics': false }, { 'admin.brands': null, 'admin.seasons': true })).toEqual({
      'sales.statistics': false,
      'admin.seasons': true,
    });
  });

  it('records as edits only the leaves where the shown map differs from the server', () => {
    const server = { 'admin.brands': true, 'sales.statistics': false };
    expect(editsBetween(server, { 'sales.statistics': false, 'admin.seasons': true })).toEqual({
      'admin.brands': null,
      'admin.seasons': true,
    });
    expect(editsBetween(server, server)).toEqual({});
  });

  it('never makes an edit of a leaf the administrator did not touch, whatever the server says now', () => {
    // Another administrator added `admin.vendors` after this dialog read the server; a new read
    // shows it, and the shown map follows it rather than turning it into a deletion.
    const edits = { 'admin.brands': true };
    const newServer = { 'admin.vendors': true };
    expect(editsBetween(newServer, applyEdits(newServer, edits))).toEqual({ 'admin.brands': true });
  });

  it('sends only the edits on leaves the kill switch does not cover', () => {
    expect(sendableEdits({ 'admin.brands': true, 'admin.seasons': null }, ['admin.brands'])).toEqual([
      ['admin.seasons', null],
    ]);
  });

  it('drops the edits the server already reflects', () => {
    expect(withoutReflected({ 'admin.brands': true, 'admin.seasons': null, 'admin.vendors': false }, { 'admin.brands': true, 'admin.vendors': true })).toEqual({
      'admin.vendors': false,
    });
  });

  it('resets editable leaves to the role defaults and leaves killed ones as they are', () => {
    const server = { 'admin.brands': true, 'admin.seasons': false };
    const edits = { 'admin.vendors': true, 'admin.phase_catalog': false };
    // `admin.brands` and `admin.phase_catalog` are killed: their server override and their edit stay.
    expect(resetEditsToRoleDefaults(server, edits, ['admin.brands', 'admin.phase_catalog'])).toEqual({
      'admin.seasons': null,
      'admin.phase_catalog': false,
    });
  });
});

describe('sectionTree — any depth', () => {
  it('lists a grandchild under its parent and switches it, never the intermediate parent', async () => {
    vi.resetModules();
    vi.doMock('@luke/core', async importOriginal => {
      const actual = await importOriginal<typeof import('@luke/core')>();
      const tree: Record<string, string[]> = { admin: ['admin.brands'], 'admin.brands': ['admin.brands.logos'] };
      return {
        ...actual,
        sectionEnum: { options: ['dashboard', 'admin', 'admin.brands', 'admin.brands.logos'] },
        childSectionsOf: (s: string) => tree[s] ?? [],
        ancestorSectionsOf: (s: string) => (s.includes('.') ? [s.slice(0, s.lastIndexOf('.'))] : []),
      };
    });
    const deep = await import('../sectionTree');

    expect(deep.sectionRows()).toEqual(['dashboard', 'admin', 'admin.brands', 'admin.brands.logos']);
    expect(deep.toggleSection({}, 'admin', true, () => false, [])).toEqual({ 'admin.brands.logos': true });

    vi.doUnmock('@luke/core');
    vi.resetModules();
  });
});
