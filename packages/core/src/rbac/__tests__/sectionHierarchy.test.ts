import { describe, expect, it } from 'vitest';

import { Roles } from '../../rbac.js';
import { SECTION_ACCESS_DEFAULTS, sectionEnum, type Section } from '../../schemas/rbac.js';
import { effectiveSectionAccess } from '../effectiveAccess.js';
import { ancestorSectionsOf, childSectionsOf, parentSectionOf } from '../sectionHierarchy.js';

const SECTIONS: readonly Section[] = sectionEnum.options;

/** The static table in the `'enabled' | 'disabled'` shape `getRbacConfig` hands the resolver. */
const STATIC_DEFAULTS = Object.fromEntries(
  Object.entries(SECTION_ACCESS_DEFAULTS).map(([role, sections]) => [
    role,
    Object.fromEntries(
      Object.entries(sections).map(([section, on]) => [section, on ? 'enabled' : 'disabled'])
    ),
  ])
) as Record<string, Partial<Record<Section, 'enabled' | 'disabled'>>>;

describe('section hierarchy', () => {
  it('gives every dotted section a parent that exists in the enum', () => {
    for (const section of SECTIONS.filter(s => s.includes('.'))) {
      const parent = parentSectionOf(section);
      expect(parent, section).not.toBeNull();
      expect(childSectionsOf(parent!), section).toContain(section);
    }
  });

  it('gives root sections no parent', () => {
    for (const section of SECTIONS.filter(s => !s.includes('.'))) {
      expect(parentSectionOf(section), section).toBeNull();
    }
  });

  it('lists ancestors nearest first', () => {
    expect(ancestorSectionsOf('admin.brands')).toEqual(['admin']);
    expect(ancestorSectionsOf('admin')).toEqual([]);
  });

  it('has sections both with and without children today', () => {
    expect(childSectionsOf('admin').length).toBeGreaterThan(0);
    expect(childSectionsOf('dashboard')).toEqual([]);
  });
});

describe('effectiveSectionAccess — derived parents (ADR-025)', () => {
  const base = { role: 'viewer', sectionAccessDefaults: STATIC_DEFAULTS, disabledSections: [] };

  it('turns a parent on when one child is on, whatever the parent itself says', () => {
    const userOverrides = new Map([
      ['admin', false],
      ['admin.brands', true],
    ]);
    expect(effectiveSectionAccess({ ...base, userOverrides, section: 'admin' })).toBe(true);
    expect(effectiveSectionAccess({ ...base, userOverrides, section: 'admin.brands' })).toBe(true);
  });

  it('turns a parent off when every child is off, even with a parent override', () => {
    const userOverrides = new Map([['admin', true]]);
    expect(effectiveSectionAccess({ ...base, userOverrides, section: 'admin' })).toBe(false);
  });

  it('switches off a whole group when its parent is in the kill switch', () => {
    const userOverrides = new Map([['admin.brands', true]]);
    const params = { ...base, userOverrides, disabledSections: ['admin'] };
    expect(effectiveSectionAccess({ ...params, section: 'admin.brands' })).toBe(false);
    expect(effectiveSectionAccess({ ...params, section: 'admin' })).toBe(false);
  });

  it('switches a parent off when every child is in the kill switch', () => {
    const role = 'admin';
    const disabledSections = [...childSectionsOf('sales')];
    const params = { ...base, role, userOverrides: null, disabledSections };
    expect(effectiveSectionAccess({ ...params, section: 'sales' })).toBe(false);
  });

  it('leaves a section without children on its own four levels', () => {
    const params = { ...base, userOverrides: new Map([['dashboard', false]]) };
    expect(effectiveSectionAccess({ ...params, section: 'dashboard' })).toBe(false);
    expect(effectiveSectionAccess({ ...base, userOverrides: null, section: 'dashboard' })).toBe(
      SECTION_ACCESS_DEFAULTS.viewer.dashboard
    );
  });

  it('never yields a child on with its parent off, nor a parent on with no child on', () => {
    // Exhaustive over every group: every combination of child overrides, with and without a
    // contradicting parent override and a kill switch on the parent.
    for (const parent of SECTIONS.filter(s => childSectionsOf(s).length > 0)) {
      const children = childSectionsOf(parent);
      for (let mask = 0; mask < 1 << children.length; mask++) {
        for (const parentOverride of [true, false, undefined]) {
          for (const disabledSections of [[], [parent]]) {
            const userOverrides = new Map<string, boolean>(
              children.map((child, i) => [child, (mask & (1 << i)) !== 0])
            );
            if (parentOverride !== undefined) userOverrides.set(parent, parentOverride);
            const params = { ...base, userOverrides, disabledSections };
            const parentOn = effectiveSectionAccess({ ...params, section: parent });
            const anyChildOn = children.some(child =>
              effectiveSectionAccess({ ...params, section: child })
            );
            const label = JSON.stringify({ parent, mask, parentOverride, disabledSections });
            expect(parentOn, label).toBe(anyChildOn);
          }
        }
      }
    }
  });
});

describe('static SECTION_ACCESS_DEFAULTS', () => {
  it('already agree with derived parents, so no role changes on the static defaults', () => {
    for (const role of Roles) {
      for (const section of SECTIONS.filter(s => childSectionsOf(s).length > 0)) {
        const derived = effectiveSectionAccess({
          role,
          sectionAccessDefaults: STATIC_DEFAULTS,
          userOverrides: null,
          section,
          disabledSections: [],
        });
        expect(derived, `${role} ${section}`).toBe(SECTION_ACCESS_DEFAULTS[role][section]);
      }
    }
  });
});
