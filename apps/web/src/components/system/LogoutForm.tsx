import { Button } from '../ui/button';

import type { ReactNode } from 'react';

/**
 * Signing out as a native form post to `/api/auth/logout` (#238, ADR-048): no JavaScript, no
 * hooks and no providers, so it works on every page and in every state — a failed layout, the
 * global error page, the maintenance lock. `children` replaces the default button with another
 * submit control.
 */
export function LogoutForm({ children }: { children?: ReactNode }) {
  return (
    <form method="post" action="/api/auth/logout">
      {children ?? (
        <Button type="submit" variant="outline">
          Esci
        </Button>
      )}
    </form>
  );
}
