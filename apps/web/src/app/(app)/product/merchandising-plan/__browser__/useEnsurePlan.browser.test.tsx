import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { useEnsurePlan, type PlanPair } from '../useEnsurePlan';

/**
 * The real `useEnsurePlan` hook. Each render hands it new `create`/`store`/`onError` functions, as
 * the page does, so the tests prove its guard, not a stable dependency array.
 */

interface Plan {
  id: string;
}

function Harness({
  pair,
  plan,
  canCreate,
  create,
  store,
}: {
  pair: PlanPair;
  plan: Plan | null | undefined;
  canCreate: boolean;
  create: (pair: PlanPair) => Promise<Plan>;
  store: (pair: PlanPair, plan: Plan) => void;
}) {
  useEnsurePlan(pair.brandId, pair.seasonId, plan, canCreate, {
    create: p => create(p),
    store: (p, created) => store(p, created),
    onError: () => {},
  });
  return <div>rendered</div>;
}

const A = { brandId: 'brand-a', seasonId: 'season-1' };
const B = { brandId: 'brand-b', seasonId: 'season-1' };

/** A creation the test settles by hand, to switch pairs while it is pending. */
function deferred() {
  let resolve!: (plan: Plan) => void;
  const promise = new Promise<Plan>(r => { resolve = r; });
  return { promise, resolve };
}

describe('useEnsurePlan', () => {
  test('creates a missing plan once, across re-renders', async () => {
    const create = vi.fn(async () => ({ id: 'plan-a' }));
    const store = vi.fn();

    const screen = await render(<Harness pair={A} plan={null} canCreate create={create} store={store} />);
    await screen.rerender(<Harness pair={A} plan={null} canCreate create={create} store={store} />);

    await vi.waitFor(() => expect(store).toHaveBeenCalledWith(A, { id: 'plan-a' }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('creates nothing while get is loading, when a plan exists, or for a user who may not create', async () => {
    const create = vi.fn(async () => ({ id: 'x' }));
    const store = vi.fn();

    const screen = await render(<Harness pair={A} plan={undefined} canCreate create={create} store={store} />);
    await screen.rerender(<Harness pair={A} plan={{ id: 'plan-a' }} canCreate create={create} store={store} />);
    await screen.rerender(<Harness pair={B} plan={null} canCreate={false} create={create} store={store} />);

    expect(create).not.toHaveBeenCalled();
  });

  test('a switch of pair while a creation is pending creates the next pair too, and each plan lands on its own pair', async () => {
    const forA = deferred();
    const forB = deferred();
    const create = vi.fn((pair: PlanPair) => (pair.brandId === A.brandId ? forA.promise : forB.promise));
    const store = vi.fn();

    const screen = await render(<Harness pair={A} plan={null} canCreate create={create} store={store} />);
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith(A));

    await screen.rerender(<Harness pair={B} plan={null} canCreate create={create} store={store} />);
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith(B));

    forA.resolve({ id: 'plan-a' });
    forB.resolve({ id: 'plan-b' });
    await vi.waitFor(() => expect(store).toHaveBeenCalledTimes(2));
    expect(store).toHaveBeenCalledWith(A, { id: 'plan-a' });
    expect(store).toHaveBeenCalledWith(B, { id: 'plan-b' });
  });
});
