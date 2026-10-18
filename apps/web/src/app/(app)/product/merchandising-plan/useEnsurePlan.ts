'use client';

import { useEffect, useRef } from 'react';

/** The brand/season pair a merchandising plan belongs to. */
export interface PlanPair {
  brandId: string;
  seasonId: string;
}

interface EnsurePlanActions<TPlan> {
  /** Creates the pair's plan (`merchandisingPlan.getOrCreate`). */
  create: (pair: PlanPair) => Promise<TPlan>;
  /** Stores a created plan as the given pair's `get` answer. */
  store: (pair: PlanPair, plan: TPlan) => void;
  onError: (error: unknown) => void;
}

/**
 * Creates the merchandising plan of the current brand/season pair the first time a user who may
 * create it finds none: `plan` is exactly `null`, the answer `get` gives (still `undefined` while it
 * loads). A viewer only reads (#146).
 *
 * Once per pair, not once per page: the guard is a set of pair keys, so switching brand or season
 * without leaving the page still creates the next pair's plan. A plan that arrives after such a switch
 * is stored under the pair it was created for, never the current one. Like `useGoogleOAuthCallback`,
 * the guard — not the dependency array — keeps the effect from acting twice, so the array can be
 * complete although `create`, `store` and `onError` are new functions on every render.
 */
export function useEnsurePlan<TPlan>(
  brandId: string | undefined,
  seasonId: string | undefined,
  plan: TPlan | null | undefined,
  canCreate: boolean,
  { create, store, onError }: EnsurePlanActions<TPlan>
): void {
  const requested = useRef(new Set<string>());

  useEffect(() => {
    if (!brandId || !seasonId || !canCreate || plan !== null) return;
    const key = `${brandId}:${seasonId}`;
    if (requested.current.has(key)) return;
    requested.current.add(key);

    const pair = { brandId, seasonId };
    create(pair).then(created => store(pair, created), onError);
  }, [brandId, seasonId, plan, canCreate, create, store, onError]);
}
