import { describe, expect, it } from 'vitest';

import { childSectionsOf, type Section } from '@luke/core';

import {
  isSectionLocked,
  isSectionOverridden,
  leafOverridesOnly,
  resetSection,
  sectionRows,
  sectionValue,
  toggleSection,
} from '../sectionTree';

/** A role that has nothing by default, like a viewer on `admin`. */
const nothing = () => false;
/** A role that has everything by default, like an admin. */
const everything = () => true;

describe('sectionTree', () => {
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
    const next = toggleSection({}, 'admin', true, nothing);
    for (const child of childSectionsOf('admin')) expect(next[child]).toBe(true);
    expect('admin' in next).toBe(false);
  });

  it('turns every child off when a parent is switched off', () => {
    const next = toggleSection({}, 'admin', false, everything);
    for (const child of childSectionsOf('admin')) expect(next[child]).toBe(false);
  });

  it('shows the parent on when one child is on, and off again when the last child goes off', () => {
    let overrides = toggleSection({}, 'admin.brands', true, nothing);
    expect(sectionValue('admin', overrides, nothing, [])).toBe(true);

    overrides = toggleSection(overrides, 'admin.brands', false, nothing);
    expect(sectionValue('admin', overrides, nothing, [])).toBe(false);
  });

  it('drops an override that equals the role default instead of storing it', () => {
    expect(toggleSection({}, 'admin.brands', false, nothing)).toEqual({});
  });

  it('shows anything the kill switch covers as off and locked, whatever the override', () => {
    const overrides = { 'admin.brands': true };
    expect(sectionValue('admin.brands', overrides, nothing, ['admin'])).toBe(false);
    expect(sectionValue('admin', overrides, nothing, ['admin'])).toBe(false);
    expect(isSectionLocked('admin.brands', ['admin'])).toBe(true);
    expect(isSectionLocked('admin', [...childSectionsOf('admin')])).toBe(true);
    expect(isSectionLocked('admin', ['admin.brands'])).toBe(false);
  });

  it('resets a parent by resetting every child', () => {
    const overrides = toggleSection({}, 'admin', true, nothing);
    expect(isSectionOverridden('admin', overrides)).toBe(true);
    expect(resetSection(overrides, 'admin')).toEqual({});
  });

  it('keeps only leaf overrides from what the server returns', () => {
    const stored: Partial<Record<Section, boolean>> = { admin: true, 'admin.brands': true };
    expect(leafOverridesOnly(stored)).toEqual({ 'admin.brands': true });
  });
});
