import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import CollectionLayoutPage from '../page';

/**
 * With no layout for the brand and season, the page shows an empty state that collects the genders
 * of a blank layout and the rows (with or without quotations) to copy from another season, and
 * hands them to the page. The page dropped both, so the API received neither.
 */

const BRAND = 'brand-1';
const SEASON = 'season-current';
const PREVIOUS = 'season-previous';
const OLDER = 'season-older';

const h = vi.hoisted(() => ({
  query: (_path: string, _input?: { seasonId?: string }): unknown => undefined,
  mutate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin' }, accessToken: 't' } }),
}));
vi.mock('../../../../../contexts/AppContextProvider', () => ({
  useAppContext: () => ({
    brand: { id: BRAND, name: 'Nike' },
    season: { id: SEASON, code: 'SS', year: 2027 },
    isLoading: false,
  }),
}));
// The page reaches about fifteen procedures. Every path answers: a query from `h.query` (honouring
// `enabled` and `select`), a mutation by recording its input under the path.
vi.mock('../../../../../lib/trpc', () => {
  const procedure = (path: string): unknown =>
    new Proxy(() => undefined, {
      apply: () => procedure(path),
      get: (_target, key) => {
        if (key === 'useQuery') {
          return (
            input?: { seasonId?: string },
            options?: { enabled?: boolean; select?: (data: unknown) => unknown }
          ) => {
            const data = options?.enabled === false ? undefined : h.query(path, input);
            return { data: data !== undefined && options?.select ? options.select(data) : data, isLoading: false };
          };
        }
        if (key === 'useMutation') {
          return () => ({ mutate: (input: unknown) => h.mutate(path, input), isPending: false });
        }
        return procedure(path ? `${path}.${String(key)}` : String(key));
      },
    });
  return { trpc: procedure('') };
});

const row = (id: string, line: string) => ({ id, gender: 'MAN', line, article: null });

beforeEach(() => {
  h.mutate.mockClear();
  h.query = (path, input) => {
    if (path === 'season.list') {
      return {
        items: [
          { id: SEASON, code: 'SS', year: 2027 },
          { id: PREVIOUS, code: 'FW', year: 2026 },
          { id: OLDER, code: 'SS', year: 2026 },
        ],
      };
    }
    if (path === 'collectionLayout.get' && input?.seasonId === PREVIOUS) {
      return {
        groups: [{ id: 'group-1', name: 'Borse', rows: [row('row-1', 'Tote'), row('row-2', 'Clutch'), row('row-3', 'Zaino')] }],
      };
    }
    if (path === 'collectionLayout.get' && input?.seasonId === OLDER) {
      return { groups: [{ id: 'group-2', name: 'Scarpe', rows: [row('row-4', 'Sneaker'), row('row-5', 'Mocassino')] }] };
    }
    return undefined;
  };
});

test('a blank layout is created with the genders chosen', async () => {
  const screen = await render(<CollectionLayoutPage />);

  await screen.getByRole('button', { name: 'Solo Uomo' }).click();
  await screen.getByRole('button', { name: 'Crea layout vuoto' }).click();

  expect(h.mutate).toHaveBeenCalledWith('collectionLayout.getOrCreate', {
    brandId: BRAND,
    seasonId: SEASON,
    availableGenders: ['MAN'],
  });
});

test('a copy sends the rows and quotations chosen', async () => {
  const screen = await render(<CollectionLayoutPage />);

  await screen.getByRole('button', { name: 'Copia da stagione precedente' }).click();
  await screen.getByRole('button', { name: 'FW 2026' }).click();
  await screen.getByRole('button', { name: 'Avanti →' }).click();
  // Two checkboxes per row, in row order: include, then quotations.
  const boxes = screen.getByRole('dialog').getByRole('checkbox');
  await boxes.nth(1).click();
  await boxes.nth(2).click();
  await screen.getByRole('button', { name: 'Copia 2 righe' }).click();

  expect(h.mutate).toHaveBeenCalledWith('collectionLayout.copyFromSeason', {
    fromBrandId: BRAND,
    fromSeasonId: PREVIOUS,
    toBrandId: BRAND,
    toSeasonId: SEASON,
    rows: [
      { id: 'row-1', copyQuotations: false },
      { id: 'row-3', copyQuotations: true },
    ],
  });
});

test('going back to pick another season copies that season\'s rows', async () => {
  const screen = await render(<CollectionLayoutPage />);

  await screen.getByRole('button', { name: 'Copia da stagione precedente' }).click();
  await screen.getByRole('button', { name: 'FW 2026' }).click();
  await screen.getByRole('button', { name: 'Avanti →' }).click();
  await screen.getByRole('button', { name: 'Indietro' }).click();
  await screen.getByRole('button', { name: 'SS 2026' }).click();
  await screen.getByRole('button', { name: 'Avanti →' }).click();
  await screen.getByRole('button', { name: /^Copia \d+ righ[ae]$/ }).click();

  expect(h.mutate).toHaveBeenCalledWith(
    'collectionLayout.copyFromSeason',
    expect.objectContaining({
      fromSeasonId: OLDER,
      rows: [
        { id: 'row-4', copyQuotations: true },
        { id: 'row-5', copyQuotations: true },
      ],
    })
  );
});
