import { ancestorSectionsOf, childSectionsOf, sectionEnum, type Section } from '@luke/core';

/**
 * Tree semantics for the section-access switches (ADR-025): a parent section is derived from its
 * children, so it is shown on when at least one child is on, and switching it switches every
 * child. Only child (leaf) overrides are ever edited or saved; a parent override would be ignored
 * by the server's resolver and is refused by `sectionAccess.set`.
 */

/** Pending per-section overrides. A missing key inherits the role default. */
export type SectionOverrides = Partial<Record<string, boolean>>;

/** Every section, each root followed by its children, in `sectionEnum` order. */
export function sectionRows(): Section[] {
  return sectionEnum.options
    .filter(section => ancestorSectionsOf(section).length === 0)
    .flatMap(root => [root, ...childSectionsOf(root)]);
}

/** The leaves a switch acts on: the section itself, or every child of a parent. */
function leavesOf(section: Section): readonly Section[] {
  const children = childSectionsOf(section);
  return children.length > 0 ? children : [section];
}

/** `true` when the kill switch covers the section or a section it is nested under. */
function isKilled(section: Section, disabledSections: readonly string[]): boolean {
  return [section, ...ancestorSectionsOf(section)].some(s => disabledSections.includes(s));
}

/** `true` when the kill switch leaves nothing to switch: every leaf under the section is killed. */
export function isSectionLocked(section: Section, disabledSections: readonly string[]): boolean {
  return leavesOf(section).every(leaf => isKilled(leaf, disabledSections));
}

/**
 * The value a switch shows: the override or the role default for a leaf, the OR of its children
 * for a parent, and `false` for anything the kill switch covers.
 */
export function sectionValue(
  section: Section,
  overrides: SectionOverrides,
  roleDefault: (section: Section) => boolean,
  disabledSections: readonly string[]
): boolean {
  return leavesOf(section).some(
    leaf => !isKilled(leaf, disabledSections) && (overrides[leaf] ?? roleDefault(leaf))
  );
}

/** Whether any leaf the switch acts on carries an explicit override. */
export function isSectionOverridden(section: Section, overrides: SectionOverrides): boolean {
  return leavesOf(section).some(leaf => leaf in overrides);
}

/**
 * Switches a section on or off. For a parent, every child follows. An override equal to the role
 * default is dropped rather than stored, so the user keeps inheriting future default changes.
 */
export function toggleSection(
  overrides: SectionOverrides,
  section: Section,
  checked: boolean,
  roleDefault: (section: Section) => boolean
): SectionOverrides {
  const next = { ...overrides };
  for (const leaf of leavesOf(section)) {
    if (checked === roleDefault(leaf)) {
      delete next[leaf];
    } else {
      next[leaf] = checked;
    }
  }
  return next;
}

/** Drops the section's overrides — every child's, for a parent — back to the role default. */
export function resetSection(overrides: SectionOverrides, section: Section): SectionOverrides {
  const next = { ...overrides };
  for (const leaf of leavesOf(section)) delete next[leaf];
  return next;
}

/** Keeps only leaf overrides: a stored parent override predates ADR-025 and means nothing now. */
export function leafOverridesOnly(overrides: SectionOverrides): SectionOverrides {
  return Object.fromEntries(
    Object.entries(overrides).filter(([section]) =>
      sectionEnum.options.some(s => s === section && childSectionsOf(s).length === 0)
    )
  );
}
