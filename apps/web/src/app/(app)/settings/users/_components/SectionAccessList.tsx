'use client';

import { childSectionsOf, type Section } from '@luke/core';

import { Button } from '../../../../../components/ui/button';
import { Label } from '../../../../../components/ui/label';
import { Switch } from '../../../../../components/ui/switch';
import {
  isSectionLocked,
  isSectionOverridden,
  resetSection,
  sectionRows,
  sectionValue,
  toggleSection,
  type SectionOverrides,
} from '../../../../../lib/sectionTree';

import { SECTION_LABELS } from './types';

interface SectionAccessListProps {
  overrides: SectionOverrides;
  onChange: (next: SectionOverrides) => void;
  /** The role default for a leaf section, as resolved by the server (`sectionAccess.getDefaults`). */
  roleDefault: (section: Section) => boolean;
  /** The kill switch (`app.sections.disabled`), shown as off and locked whatever the override. */
  disabledSections: readonly string[];
}

/**
 * The section-visibility switches shared by the user access and approval dialogs. A parent
 * section shows the state of its children and switches all of them (ADR-025); only leaf
 * overrides are ever produced.
 */
export function SectionAccessList({
  overrides,
  onChange,
  roleDefault,
  disabledSections,
}: SectionAccessListProps) {
  return (
    <div className="space-y-2">
      {sectionRows().map(section => {
        const isParent = childSectionsOf(section).length > 0;
        const locked = isSectionLocked(section, disabledSections);
        const overridden = isSectionOverridden(section, overrides);
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
                checked={sectionValue(section, overrides, roleDefault, disabledSections)}
                disabled={locked}
                onCheckedChange={checked =>
                  onChange(toggleSection(overrides, section, checked, roleDefault))
                }
              />
              {overridden && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1 text-xs text-muted-foreground"
                  onClick={() => onChange(resetSection(overrides, section))}
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
