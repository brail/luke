import { sectionEnum, type Section } from '../schemas/rbac.js';

/**
 * The section tree, derived from the dot notation of `sectionEnum` (`admin.brands` is a child of
 * `admin`) rather than listed by hand, so a section added to the enum joins its group with no
 * other edit. A parent section's access is derived from its children (ADR-025): this module is
 * the one place that says which sections are parents.
 */

const SECTIONS: readonly Section[] = sectionEnum.options;

function lookupParent(section: Section): Section | null {
  const dot = section.lastIndexOf('.');
  if (dot === -1) return null;
  const prefix = section.slice(0, dot);
  return SECTIONS.find(candidate => candidate === prefix) ?? null;
}

const PARENT_OF: ReadonlyMap<Section, Section | null> = new Map(
  SECTIONS.map(section => [section, lookupParent(section)])
);

const CHILDREN_OF: ReadonlyMap<Section, readonly Section[]> = new Map(
  SECTIONS.map(section => [section, SECTIONS.filter(other => PARENT_OF.get(other) === section)])
);

/** The section this one is nested under (`admin` for `admin.brands`), or `null` for a root. */
export function parentSectionOf(section: Section): Section | null {
  return PARENT_OF.get(section) ?? null;
}

/** The sections directly nested under this one, in `sectionEnum` order; empty for a leaf. */
export function childSectionsOf(section: Section): readonly Section[] {
  return CHILDREN_OF.get(section) ?? [];
}

/** Every section this one is nested under, nearest first. */
export function ancestorSectionsOf(section: Section): Section[] {
  const ancestors: Section[] = [];
  for (let parent = parentSectionOf(section); parent !== null; parent = parentSectionOf(parent)) {
    ancestors.push(parent);
  }
  return ancestors;
}
