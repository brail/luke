import {
  ancestorSectionsOf,
  childSectionsOf,
  isGloballyDisabled,
  sectionEnum,
  type Section,
} from '@luke/core';

/**
 * Tree semantics for the section-access switches (ADR-027): a parent section is derived from its
 * children, so it is shown on when at least one child is on, and switching it switches the leaves
 * under it. Only leaf overrides are ever edited or saved; `sectionAccess.set` refuses a parent.
 *
 * A switch acts only on the leaves the kill switch does not cover: those are shown off and locked,
 * and an override written on one would surface, unseen, the day the kill switch is lifted.
 */

/** Per-section overrides. A missing key inherits the role default. */
export type SectionOverrides = Partial<Record<string, boolean>>;

/**
 * The administrator's edits over the server's overrides: the value chosen for a leaf they switched,
 * `null` to remove its override. A missing key is no edit at all.
 */
export type SectionEdits = Partial<Record<string, boolean | null>>;

/** Every section in tree order: each root, then everything under it, depth first. */
export function sectionRows(): Section[] {
  const walk = (section: Section): Section[] => [section, ...childSectionsOf(section).flatMap(walk)];
  return sectionEnum.options.filter(section => ancestorSectionsOf(section).length === 0).flatMap(walk);
}

/** The leaves under a section at any depth, or the section itself when it is a leaf. */
function leavesUnder(section: Section): Section[] {
  const children = childSectionsOf(section);
  return children.length > 0 ? children.flatMap(leavesUnder) : [section];
}

/** The leaves a switch acts on: those under it that the kill switch does not cover. */
function switchableLeaves(section: Section, disabledSections: readonly string[]): Section[] {
  return leavesUnder(section).filter(leaf => !isGloballyDisabled(leaf, disabledSections));
}

/** Every section without children. */
export function leafSections(): Section[] {
  return sectionEnum.options.filter(section => childSectionsOf(section).length === 0);
}

/** `true` when the kill switch leaves nothing to switch under the section. */
export function isSectionLocked(section: Section, disabledSections: readonly string[]): boolean {
  return switchableLeaves(section, disabledSections).length === 0;
}

/** Whether a leaf the switch acts on carries an explicit override. */
export function isSectionOverridden(
  section: Section,
  overrides: SectionOverrides,
  disabledSections: readonly string[]
): boolean {
  return switchableLeaves(section, disabledSections).some(leaf => leaf in overrides);
}

/**
 * Switches a section on or off: the section itself, or every switchable leaf under a parent. An
 * override equal to the role default is dropped rather than stored, so the user keeps inheriting
 * future default changes.
 */
export function toggleSection(
  overrides: SectionOverrides,
  section: Section,
  checked: boolean,
  roleDefault: (section: Section) => boolean,
  disabledSections: readonly string[]
): SectionOverrides {
  const next = { ...overrides };
  for (const leaf of switchableLeaves(section, disabledSections)) {
    if (checked === roleDefault(leaf)) {
      delete next[leaf];
    } else {
      next[leaf] = checked;
    }
  }
  return next;
}

/** Drops the overrides of the switchable leaves under a section, back to the role default. */
export function resetSection(
  overrides: SectionOverrides,
  section: Section,
  disabledSections: readonly string[]
): SectionOverrides {
  const next = { ...overrides };
  for (const leaf of switchableLeaves(section, disabledSections)) delete next[leaf];
  return next;
}

/** The overrides a dialog shows: the server's, with the administrator's edits over them. */
export function applyEdits(server: SectionOverrides, edits: SectionEdits): SectionOverrides {
  const shown = { ...server };
  for (const [leaf, value] of Object.entries(edits)) {
    if (value === null) delete shown[leaf];
    else if (value !== undefined) shown[leaf] = value;
  }
  return shown;
}

/**
 * The edits that turn `server` into `shown`: one per leaf where they differ. Computed from what the
 * administrator switched, so a leaf they did not touch is never an edit, whatever the server holds.
 */
export function editsBetween(server: SectionOverrides, shown: SectionOverrides): SectionEdits {
  const edits: SectionEdits = {};
  for (const leaf of new Set([...Object.keys(server), ...Object.keys(shown)])) {
    const now = shown[leaf] ?? null;
    if ((server[leaf] ?? null) !== now) edits[leaf] = now;
  }
  return edits;
}

/** The edits a save sends, as `[section, value]`: those on leaves the kill switch does not cover. */
export function sendableEdits(
  edits: SectionEdits,
  disabledSections: readonly string[]
): Array<[Section, boolean | null]> {
  return leafSections()
    .filter(leaf => leaf in edits && !isGloballyDisabled(leaf, disabledSections))
    .map(leaf => [leaf, edits[leaf] ?? null]);
}

/** The edits a server read does not already reflect. */
export function withoutReflected(edits: SectionEdits, server: SectionOverrides): SectionEdits {
  return Object.fromEntries(
    Object.entries(edits).filter(([leaf, value]) => (server[leaf] ?? null) !== (value ?? null))
  );
}

/**
 * Every switchable leaf back to the role default: `null` where the server holds an override, no
 * edit where it does not. Leaves the kill switch covers keep their override and their edit, so
 * lifting it shows them as they were.
 */
export function resetEditsToRoleDefaults(
  server: SectionOverrides,
  edits: SectionEdits,
  disabledSections: readonly string[]
): SectionEdits {
  const next: SectionEdits = {};
  for (const leaf of leafSections()) {
    if (isGloballyDisabled(leaf, disabledSections)) {
      if (leaf in edits) next[leaf] = edits[leaf];
    } else if (leaf in server) {
      next[leaf] = null;
    }
  }
  return next;
}
