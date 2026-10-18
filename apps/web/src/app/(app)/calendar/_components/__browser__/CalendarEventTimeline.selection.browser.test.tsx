import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { CalendarEventTimeline } from '../CalendarEventTimeline';

import type { CalendarEventItem } from '../types';

/**
 * Bulk deletion offers only the events the server would delete: a cancelled event and a phase event
 * of a frozen group cannot be ticked, and "Seleziona tutto" leaves them out.
 */

function event(id: string, extra: Partial<CalendarEventItem> = {}): CalendarEventItem {
  return { id, title: id, startAt: '2026-12-10T00:00:00.000Z', endAt: null, allDay: true, publishExternally: false, visibilities: [], planningGroupId: 'g1', ...extra };
}

test('offers only deletable events for bulk deletion', async () => {
  const onBulkDelete = vi.fn();
  const screen = await render(
    // The app mounts TooltipProvider once (components/Providers.tsx); PermissionTooltip needs it.
    <TooltipProvider delayDuration={0}>
      <CalendarEventTimeline
        milestones={[
          event('Libero'),
          event('Annullato', { cancelledAt: '2026-10-01T00:00:00.000Z' }),
          event('Congelato', { phaseId: 'p1', planningGroupFrozenAt: '2026-10-01T00:00:00.000Z' }),
        ]}
        zone="Europe/Rome" onEventClick={() => {}} onBulkDelete={onBulkDelete} functionsById={{}} brandColorMap={{}} canUpdate />
    </TooltipProvider>,
  );

  await expect.element(screen.getByRole('checkbox', { name: 'Seleziona Annullato' })).toBeDisabled();
  await expect.element(screen.getByRole('checkbox', { name: 'Seleziona Congelato' })).toBeDisabled();

  await screen.getByRole('checkbox', { name: 'Seleziona tutto' }).click();
  await screen.getByRole('button', { name: 'Elimina selezionata' }).click();
  await screen.getByRole('button', { name: 'Elimina', exact: true }).click();
  expect(onBulkDelete).toHaveBeenCalledWith(['Libero']);
});
