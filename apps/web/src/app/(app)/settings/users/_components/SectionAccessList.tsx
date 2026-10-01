'use client';

import {
  childSectionsOf,
  effectiveSectionAccess,
  type Section,
  type SectionDefault,
} from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import { Label } from '../../../../../components/ui/label';
import { Switch } from '../../../../../components/ui/switch';
import {
  isSectionLocked,
  isSectionOverridden,
  resetSection,
  sectionRows,
  toggleSection,
  type SectionOverrides,
} from '../../../../../lib/sectionTree';

import { SECTION_LABELS } from './types';

interface SectionAccessListProps {
  /** The role whose defaults the overrides sit on. */
  role: string;
  /**
   * The role defaults and the kill switch (`sectionAccess.getDefaults`), or `undefined` while they
   * have not answered: until then no switch is shown, since every one would be computed against
   * an empty table.
   */
  defaults:
    | {
        sectionAccessDefaults: Record<string, Partial<Record<Section, SectionDefault>>>;
        disabledSections: string[];
      }
    | undefined;
  overrides: SectionOverrides;
  onChange: (next: SectionOverrides) => void;
  /** Every switch and reset disabled, while the dialog saves. */
  disabled?: boolean;
}

/**
 * The section-visibility switches shared by the user access and approval dialogs. Every switch is
 * resolved by the core's `effectiveSectionAccess`, the one the server enforces with: a parent shows
 * the state of its children and switches the leaves under it the kill switch does not cover
 * (ADR-027); only leaf overrides are ever produced.
 */
export function SectionAccessList({
  role,
  defaults,
  overrides,
  onChange,
  disabled = false,
}: SectionAccessListProps) {
  if (!defaults) {
    return <div className="py-4 text-center text-sm text-muted-foreground">Caricamento...</div>;
  }

  const { sectionAccessDefaults, disabledSections } = defaults;
  const userOverrides = new Map(
    Object.entries(overrides).filter((entry): entry is [string, boolean] => entry[1] !== undefined)
  );
  const resolve = (section: Section, withOverrides: boolean) =>
    effectiveSectionAccess({
      role,
      sectionAccessDefaults,
      userOverrides: withOverrides ? userOverrides : null,
      section,
      disabledSections,
    });
  const roleDefault = (section: Section) => resolve(section, false);

  return (
    <div className="space-y-2">
      {sectionRows().map(section => {
        const isParent = childSectionsOf(section).length > 0;
        const locked = isSectionLocked(section, disabledSections);
        const overridden = isSectionOverridden(section, overrides, disabledSections);
        const status = locked
          ? '(disabilitata globalmente)'
          : isParent
            ? '(segue le sottosezioni)'
            : overridden
              ? '(override)'
              : `(default: ${roleDefault(section) ? 'sì' : 'no'})`;

        return (
          <div key={section} className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <Label htmlFor={`section-${section}`} className="text-sm font-normal">
                {SECTION_LABELS[section]}
              </Label>
              <span className="text-xs text-muted-foreground">{status}</span>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id={`section-${section}`}
                checked={resolve(section, true)}
                disabled={locked || disabled}
                onCheckedChange={checked =>
                  onChange(toggleSection(overrides, section, checked, roleDefault, disabledSections))
                }
              />
              {overridden && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1 text-xs text-muted-foreground"
                  disabled={disabled}
                  onClick={() => onChange(resetSection(overrides, section, disabledSections))}
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
