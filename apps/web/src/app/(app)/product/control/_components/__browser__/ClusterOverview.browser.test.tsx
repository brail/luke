import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../../components/ui/tooltip';
import { ClusterMoqCoverage } from '../ClusterMoqCoverage';

import type { MoqCoverageRow } from '../../../../../../lib/moqCoverage';

/**
 * Control › `Criticità cluster` › `Panoramica` (#168): it opens first, one section per gender and one
 * chart per category, and renders the prototype's edge cases readably — a cluster far larger than
 * the rest, A/B exactly 0,70 beside 0,69, a 1-SKU cluster, three clusters on one strategy line, a
 * long category name — with every cluster reachable by keyboard and its details announced.
 */

const LONG_NAME = 'Stivale tecnico impermeabile da trekking in alta quota';

// B = moqPerColor × skuForecast, row by row.
const row = (gender: string, category: string, strategy: string, positioning: string, a: number, sku: number, moq: number): MoqCoverageRow =>
  ({ gender, productCategory: category, strategy, pricePositioning: positioning, qtyForecast: a, skuForecast: sku, vendor: { moqPerColor: moq } });

const h = vi.hoisted(() => ({
  catalogPending: false,
  rows: [] as MoqCoverageRow[],
}));

vi.mock('../../_hooks/useControlLayout', () => ({
  useControlLayout: () => ({ layout: { groups: [{ rows: h.rows }] }, isError: false, enabled: true, contextLoading: false }),
}));

vi.mock('../../../../../../lib/trpc', () => {
  const catalogs: Record<string, { value: string; label: string }[]> = {
    strategy: [{ value: 'CORE', label: 'Core' }, { value: 'INNOVATION', label: 'Innovation' }],
    pricePositioning: [{ value: 'ENTRY', label: 'Entry' }, { value: 'MID', label: 'Mid' }, { value: 'PREMIUM', label: 'Premium' }],
  };
  return {
    trpc: {
      collectionCatalog: {
        listAll: {
          useQuery: ({ type }: { type: string }) =>
            (h.catalogPending ? { data: undefined, isPending: true } : { data: catalogs[type], isPending: false }),
        },
      },
    },
  };
});

h.rows = [
  row('WOMAN', 'Ballerina', 'INNOVATION', 'MID', 40, 1, 60),
  row('WOMAN', 'Cupsole', 'CORE', 'ENTRY', 1900, 10, 170),
  row('WOMAN', 'Cupsole', 'CORE', 'MID', 2100, 10, 230),
  row('WOMAN', 'Cupsole', 'CORE', 'PREMIUM', 700, 7, 200),
  row('MAN', 'Running', 'CORE', 'MID', 12000, 15, 200),
  row('MAN', 'Ciabatta', 'CORE', 'ENTRY', 700, 5, 200),
  row('MAN', 'Ciabatta', 'INNOVATION', 'ENTRY', 690, 5, 200),
  row('MAN', 'Mocassino', 'CORE', 'PREMIUM', 800, 6, 0),
  row('WOMAN', 'Sandalo', 'CORE', 'ENTRY', 0, 4, 100),
  // A positioning no catalog item holds.
  row('MAN', LONG_NAME, 'CORE', 'OUTLET', 500, 5, 200),
];

afterEach(() => {
  h.catalogPending = false;
});

// The app mounts TooltipProvider once (components/Providers.tsx); every Tooltip needs it.
const renderTab = () => render(<TooltipProvider delayDuration={0}><ClusterMoqCoverage /></TooltipProvider>);

const discRadius = (cluster: Element) => Number(cluster.querySelector('circle')?.getAttribute('r'));

test('opens on Panoramica, the first sub-tab, with one section per gender in catalog order', async () => {
  const screen = await renderTab();

  expect(screen.getByRole('tab').elements().map(t => t.textContent)).toEqual(['Panoramica', 'Bolle', 'Barre', 'Matrice']);
  await expect.element(screen.getByRole('tab', { name: 'Panoramica' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { level: 4 }).elements().map(e => e.textContent)).toEqual(['Uomo', 'Donna']);
});

test('tells A/B 0,70 (Non critico) from 0,69 (Critico) in words', async () => {
  const screen = await renderTab();
  const ciabatta = screen.getByRole('group', { name: 'Uomo · Ciabatta' });

  await expect.element(ciabatta.getByRole('img', { name: /^Core, Entry: .*A\/B 0,70, 5 SKU, Non critico$/ })).toBeInTheDocument();
  await expect.element(ciabatta.getByRole('img', { name: /^Innovation, Entry: .*A\/B 0,69, 5 SKU, Critico$/ })).toBeInTheDocument();
});

test('draws three clusters of one strategy on that strategy\'s line', async () => {
  const screen = await renderTab();
  const core = screen.getByRole('group', { name: 'Donna · Cupsole' }).getByRole('img', { name: /^Core,/ }).elements();

  expect(core).toHaveLength(3);
  expect(new Set(core.map(c => c.querySelector('circle')?.getAttribute('cx'))).size).toBe(1);
});

test('one radius scale for the page: a far larger cluster leaves a 1-SKU one visible', async () => {
  const screen = await renderTab();
  const cluster = (chart: string, name?: RegExp) =>
    screen.getByRole('group', { name: chart }).getByRole('img', { name }).element();

  const discs = screen.getByRole('img').elements().map(discRadius);
  expect(discRadius(cluster('Uomo · Running'))).toBe(Math.max(...discs));
  expect(discRadius(cluster('Donna · Ballerina'))).toBeGreaterThanOrEqual(3);
  // The same A in two genders draws the same disc.
  expect(discRadius(cluster('Donna · Cupsole', /^Core, Premium/))).toBe(discRadius(cluster('Uomo · Ciabatta', /^Core, Entry/)));
});

test('a cluster with no minimum has no ratio and is not critical', async () => {
  const screen = await renderTab();

  await expect.element(
    screen.getByRole('group', { name: 'Uomo · Mocassino' }).getByRole('img', { name: 'Core, Premium: A 800, B 0, A/B —, 6 SKU, Non critico' })
  ).toBeInTheDocument();
});

test('a cluster with no forecast still shows its status, as a dot', async () => {
  const screen = await renderTab();
  const sandalo = screen.getByRole('group', { name: 'Donna · Sandalo' }).getByRole('img', { name: /, Critico$/ });

  await expect.element(sandalo).toBeInTheDocument();
  expect(discRadius(sandalo.element())).toBeGreaterThanOrEqual(3);
});

test('a positioning absent from the catalog goes above the catalog\'s, under its raw value', async () => {
  const screen = await renderTab();
  const chart = screen.getByRole('group', { name: `Uomo · ${LONG_NAME}` }).element();

  // Bottom to top; the full label sits in each axis label's <title>.
  expect([...chart.querySelectorAll('[data-axis="positioning"] title')].map(t => t.textContent))
    .toEqual(['Entry', 'Mid', 'Premium', 'OUTLET']);
});

test('a long category name wraps under its chart instead of overflowing', async () => {
  const screen = await renderTab();
  const caption = screen.getByRole('figure', { name: LONG_NAME }).getByText(LONG_NAME).element();

  expect(caption.scrollWidth).toBeLessThanOrEqual(caption.clientWidth);
});

test('every cluster is reachable by keyboard, and focus shows its details', async () => {
  const screen = await renderTab();
  const clusters = screen.getByRole('img').elements();

  expect(clusters).toHaveLength(h.rows.length);
  expect(clusters.every(c => c.getAttribute('tabindex') === '0')).toBe(true);

  const ciabatta = screen.getByRole('group', { name: 'Uomo · Ciabatta' }).getByRole('img', { name: /^Innovation, Entry/ });
  // `element()` is typed as a plain Element; the cluster is an SVG <g>, which has `focus()`.
  (ciabatta.element() as SVGGElement).focus();

  // The first match is the painted content; Radix repeats it, visually hidden, for screen readers.
  await expect.element(screen.getByText('A (forecast) 690 paia').first()).toBeVisible();
  await expect.element(screen.getByText('A/B 0,69 · 5 SKU').first()).toBeVisible();
});

test('waits for the catalogs before drawing the axes', async () => {
  h.catalogPending = true;
  const screen = await renderTab();

  await expect.element(screen.getByText('Caricamento…')).toBeVisible();
  expect(screen.getByRole('img').elements()).toHaveLength(0);
});
