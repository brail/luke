import { isPhaseColor, type PhaseColor } from '@luke/core';

import { cn } from '../lib/utils';

/**
 * Each phase colour: its name, for the catalog's picker, and its badge classes, light and dark —
 * Tailwind palette pairs whose text keeps at least 6.4:1 contrast on its background in both themes
 * (WCAG AA asks 4.5:1).
 */
export const PHASE_COLOR_STYLES: Record<PhaseColor, { name: string; classes: string }> = {
  gray: { name: 'Grigio', classes: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  yellow: { name: 'Giallo', classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
  blue: { name: 'Blu', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  green: { name: 'Verde', classes: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  violet: { name: 'Viola', classes: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200' },
  rose: { name: 'Rosa', classes: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200' },
  teal: { name: 'Verde acqua', classes: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' },
  orange: { name: 'Arancione', classes: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
};

/**
 * A phase drawn in its colour. The name is always written, so the colour is never the only cue; a
 * name too long for its place ends in an ellipsis, whole in the tooltip. Null, or a stored colour
 * outside `PHASE_COLORS`, gives the neutral badge.
 */
export function PhaseBadge({ label, color }: { label: string; color: string | null | undefined }) {
  return (
    <span
      className={cn(
        'inline-block max-w-full truncate rounded px-2 py-0.5 align-middle text-xs font-medium',
        isPhaseColor(color) ? PHASE_COLOR_STYLES[color].classes : 'bg-muted text-muted-foreground',
      )}
      title={label}
    >
      {label}
    </span>
  );
}
