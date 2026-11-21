import { signOut } from 'next-auth/react';
import { toast } from 'sonner';

import { trpc } from '../lib/trpc';

/**
 * Ends the API sessions first, then the browser's. A failure keeps the user signed in, so the
 * button can be pressed again rather than leaving a live bearer behind.
 */
export function useLogout() {
  return trpc.auth.logout.useMutation({
    onSuccess: () => signOut({ callbackUrl: '/login' }),
    onError: error => {
      // The bearer is already revoked or expired: nothing is left to end with it.
      if (error.data?.code === 'UNAUTHORIZED') {
        void signOut({ callbackUrl: '/login' });
        return;
      }
      // Maintenance only when the server says so: any other 503 is not maintenance (#259).
      toast.error(
        error.data?.unavailableReason === 'maintenance'
          ? 'Uscita non disponibile durante la manutenzione: riprova al termine'
          : 'Uscita non riuscita: riprova'
      );
    },
  });
}
