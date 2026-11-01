import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../../components/ui/tooltip';
import { ParameterSetPanel } from '../ParameterSetPanel';

import type { ComponentProps } from 'react';

/** Deleting a parameter set asks for `pricing:delete`, not the `pricing:update` the other actions ask for. */

const h = vi.hoisted(() => ({ granted: [] as string[] }));

vi.mock('../../../../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: (permission: string) => h.granted.includes(permission) }),
}));

const set = (id: string, isDefault: boolean) => ({
  id,
  name: id,
  isDefault,
  countryCode: 'CN',
  purchaseCurrency: 'USD',
  sellingCurrency: 'EUR',
  qualityControlPercent: 0,
  transportInsuranceCost: 0,
  duty: 0,
  exchangeRate: 1,
  italyAccessoryCosts: 0,
  tools: 0,
  retailMultiplier: 2,
  optimalMargin: 52,
});

// Only the fields the panel renders: the query's other columns play no part here.
const sets = [set('a', true), set('b', false)] as unknown as ComponentProps<typeof ParameterSetPanel>['sets'];

const renderPanel = () =>
  render(
    <TooltipProvider>
      <ParameterSetPanel
        sets={sets}
        selectedSetId="a"
        onSelectSet={vi.fn()}
        onCreateSet={vi.fn()}
        onUpdateSet={vi.fn()}
        onDeleteSet={vi.fn()}
        onSetDefault={vi.fn()}
      />
    </TooltipProvider>
  );

beforeEach(() => {
  h.granted = [];
});

test('with pricing:update only, delete stays disabled', async () => {
  h.granted = ['pricing:update'];

  const screen = await renderPanel();

  await expect.element(screen.getByRole('button', { name: 'Elimina variante' }).first()).toBeDisabled();
});

test('with pricing:delete, delete is enabled', async () => {
  h.granted = ['pricing:update', 'pricing:delete'];

  const screen = await renderPanel();

  await expect.element(screen.getByRole('button', { name: 'Elimina variante' }).first()).toBeEnabled();
});
