'use client';

import { useEffect, useRef } from 'react';

interface SearchParamsLike {
  get: (key: string) => string | null;
}

interface ExchangeMutationLike {
  isPending: boolean;
  mutate: (input: { code: string; redirectUri: string }) => void;
}

interface ToastLike {
  error: (message: string) => void;
}

/**
 * Consumes the one-time `oauth_code`/`oauth_error` query params left by the Google OAuth
 * redirect, exchanges the code at most once, and scrubs the URL. Takes `searchParams` as a
 * parameter (rather than calling `useSearchParams()` itself) so it stays framework-agnostic and
 * directly testable — the caller (`page.tsx`) is where the real `next/navigation` hook belongs.
 *
 * `handledRef` — not the dependency array — is what makes this idempotent, which is why the
 * array below can be complete and honest instead of pinned to `[]`:
 * - React Strict Mode (dev only) mounts, unmounts and remounts every component once, running this
 *   effect twice on the same first render — without the guard, a present `code` would be
 *   exchanged twice and the "Autorizzazione negata" toast would fire twice;
 * - `exchangeMutation` and `toast` are both new objects on every render they come from (a
 *   `useMutation()` result changes identity on every `isPending`/`data` transition; `toast` is
 *   `useToast()`'s unmemoized return value) — with a complete dependency array, that alone would
 *   re-run this effect right as the mutation settles, and again on whatever render follows it,
 *   for reasons that have nothing to do with a new `code` having arrived.
 * Both facts would otherwise force excluding those dependencies outright (and losing real
 * re-entry, like the "code arrived while a mutation was already pending" case below, along with
 * it). The guard makes the exclusion unnecessary instead: the effect is free to re-run for any
 * reason, but `handledRef.current` blocks it from acting a second time once it has. It's only set
 * once something has actually been done about — an error notified, or an exchange actually
 * started — not merely seen: a mount that initially finds neither `oauth_code` nor `oauth_error`
 * (params not resolved yet), or finds a code while another mutation is already in flight, leaves
 * the guard open so a later render still handles it, rather than the window having already
 * closed. (Next 16.3.3 does patch `history.replaceState` so `useSearchParams()` reflects the
 * scrubbed URL on the next read — that isn't what `handledRef` is defending against here.)
 */
export function useGoogleOAuthCallback(
  searchParams: SearchParamsLike,
  exchangeMutation: ExchangeMutationLike,
  toast: ToastLike
): void {
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    const code = searchParams.get('oauth_code');
    const oauthError = searchParams.get('oauth_error');
    if (!code && !oauthError) return; // nothing to handle yet — leave the guard open

    if (oauthError) {
      handledRef.current = true;
      toast.error('Autorizzazione Google negata');
      return;
    }
    if (!code) return;

    // If a mutation happens to already be in flight, wait — don't mark this handled, or the
    // code would never get exchanged once the mutation frees up. `exchangeMutation` changing
    // identity when `isPending` flips is exactly what re-runs this effect for that retry.
    if (exchangeMutation.isPending) return;

    handledRef.current = true; // before mutate(): its own state change must not re-enter this
    const redirectUri = `${window.location.origin}/api/google/oauth/callback`;
    exchangeMutation.mutate({ code, redirectUri });
    // Clean URL
    window.history.replaceState({}, '', '/settings/google');
  }, [searchParams, exchangeMutation, toast]);
}
