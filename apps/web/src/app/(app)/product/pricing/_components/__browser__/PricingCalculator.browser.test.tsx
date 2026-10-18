import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import type { RouterOutputs } from '@luke/api';

import { PricingCalculator } from '../PricingCalculator';

/**
 * The calculator showed a margin of its own (#79): the unrounded chain's, coloured by a four-band
 * rule on the already rounded value. It now shows the margin of the prices it produces, rounded and
 * coloured as the collection layout row does, and the inverse details step by step.
 */

type CalcResult = RouterOutputs['pricing']['calculate'];
type ParameterSet = RouterOutputs['pricing']['parameterSets']['list'][number];

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  // What the next calculation returns; set by each test.
  result: null as unknown,
}));

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    pricing: {
      calculate: {
        useMutation: (opts: { onSuccess: (data: unknown) => void }) => ({
          mutate: (input: unknown) => {
            h.mutate(input);
            opts.onSuccess(h.result);
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
});

const SET: ParameterSet = {
  id: '00000000-0000-4000-8000-000000000001',
  brandId: '00000000-0000-4000-8000-000000000002',
  seasonId: '00000000-0000-4000-8000-000000000003',
  name: 'CINA 8%',
  countryCode: 'CN',
  purchaseCurrency: 'USD',
  sellingCurrency: 'EUR',
  qualityControlPercent: 5,
  transportInsuranceCost: 2.5,
  duty: 8,
  exchangeRate: 1.07,
  italyAccessoryCosts: 0.3,
  tools: 1,
  retailMultiplier: 2.48,
  optimalMargin: 52,
  isDefault: true,
  orderIndex: 0,
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
};

/** One distinct amount per step, so a row showing its neighbour's value fails. */
const INVERSE: CalcResult = {
  mode: 'inverse',
  retailPrice: 129.9,
  wholesalePrice: 52.38,
  landedCost: 25.18,
  priceWithoutAccessories: 24.88,
  dutyCost: 1.84,
  priceWithoutDuty: 23.04,
  priceWithoutTransport: 22.15,
  qualityControlCost: 1.01,
  purchasePriceRaw: 20.14,
  purchasePrice: 20.1,
  companyMargin: 0.51996,
  purchaseCurrency: 'USD',
  sellingCurrency: 'EUR',
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(value);
}

async function calculate(result: CalcResult, prices: { purchase?: string; retail?: string }) {
  h.result = result;
  const screen = await render(<PricingCalculator parameterSet={SET} />);
  if (prices.purchase) await screen.getByLabelText(/^Prezzo acquisto/).fill(prices.purchase);
  if (prices.retail) await screen.getByLabelText(/^Prezzo retail/).fill(prices.retail);
  await screen.getByRole('button', { name: /^Calcola/ }).click();
  await screen.getByRole('button', { name: 'Dettagli calcolo' }).click();
  return screen;
}

/** The value shown beside a details label. */
function detail(screen: Awaited<ReturnType<typeof calculate>>, label: string) {
  return screen.getByText(label, { exact: true }).element().nextElementSibling?.textContent;
}

test.each([
  { margin: 0.52, pct: '52.0', diff: '+0.0', colour: 'text-status-good' },
  // Shown as 52.0 but below target: classified and signed unrounded, as on the row.
  { margin: 0.51996, pct: '52.0', diff: '-0.0', colour: 'text-status-warning' },
  { margin: 0.49, pct: '49.0', diff: '-3.0', colour: 'text-status-warning' },
  { margin: 0.4899, pct: '49.0', diff: '-3.0', colour: 'text-status-critical' },
  // The gap is sized on the percentage shown: 40.3 − 52, not 40.25 − 52.
  { margin: 0.4025, pct: '40.3', diff: '-11.7', colour: 'text-status-critical' },
])('margin $margin reads $pct in the badge and the details, $colour', async ({ margin, pct, diff, colour }) => {
  const screen = await calculate(
    {
      mode: 'margin',
      purchasePrice: 20.1,
      retailPrice: 129.9,
      landedCost: 25.18,
      wholesalePrice: 52.38,
      companyMargin: margin,
      companyMultiplier: 1 / 0.48,
      purchaseCurrency: 'USD',
      sellingCurrency: 'EUR',
    },
    { purchase: '20.1', retail: '129.9' }
  );

  const badge = screen.getByText(`${pct}% (${diff}pp vs target 52%)`);
  await expect.element(badge).toHaveClass(colour);
  expect(detail(screen, 'Margine aziendale reale')).toBe(`${pct}%`);
});

test('inverse mode shows each step beside its own label, in its own currency', async () => {
  const screen = await calculate(INVERSE, { retail: '129.9' });

  expect(h.mutate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'inverse', retailPrice: 129.9 }));
  await expect.element(screen.getByLabelText(/^Prezzo acquisto/)).toHaveValue(20.1);
  expect(detail(screen, 'Prezzo retail')).toBe(money(129.9, 'EUR'));
  expect(detail(screen, '÷ Molt. retail → Wholesale')).toBe(money(52.38, 'EUR'));
  expect(detail(screen, '÷ Molt. aziendale → Landed')).toBe(money(25.18, 'EUR'));
  expect(detail(screen, '− Costi Italia')).toBe(money(24.88, 'EUR'));
  expect(detail(screen, '− Dazio')).toBe(money(23.04, 'EUR'));
  expect(detail(screen, '× Cambio − Trasporto')).toBe(money(22.15, 'USD'));
  expect(detail(screen, '− Stampi ÷ CQ')).toBe(money(20.14, 'USD'));
  expect(detail(screen, 'Prezzo acquisto max')).toBe(money(20.1, 'USD'));
  expect(detail(screen, 'Margine reale sul prezzo acquisto max')).toBe('52.0%');
});

test('forward mode names the exact company multiplier it applied, to four decimals', async () => {
  const screen = await calculate(
    {
      mode: 'forward',
      purchasePrice: 20.1,
      qualityControlCost: 1.01,
      priceWithQC: 22.11,
      transportInsuranceCost: 2.5,
      priceWithTransport: 24.61,
      dutyCost: 1.97,
      priceWithDuty: 26.58,
      italyAccessoryCosts: 0.3,
      landedCost: 25.14,
      companyMultiplier: 1 / 0.48,
      wholesalePrice: 52.38,
      retailPriceRaw: 129.68,
      retailPrice: 129.9,
      companyMargin: 0.5201,
      purchaseCurrency: 'USD',
      sellingCurrency: 'EUR',
    },
    { purchase: '20.1' }
  );

  await expect.element(screen.getByLabelText(/^Prezzo retail/)).toHaveValue(129.9);
  expect(detail(screen, '× Molt. aziendale (×2.0833)')).toBe(money(52.38, 'EUR'));
  expect(detail(screen, 'Landed cost (in EUR)')).toBe(money(25.14, 'EUR'));
  expect(detail(screen, 'Margine reale sul retail arrotondato')).toBe('52.0%');
});
