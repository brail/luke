'use client';

import { TRPCClientError } from '@trpc/client';
import { useState, type ReactNode } from 'react';

import { ConfirmDialog } from '../../../../components/ConfirmDialog';

/**
 * Whether `err` is the server refusing a write after which the event would leave the caller's own
 * calendar (PRECONDITION_REQUIRED, #199): one the caller may confirm and send again.
 */
function isHideFromSaverRefusal(err: unknown): err is TRPCClientError<never> {
  return err instanceof TRPCClientError && err.data?.code === 'PRECONDITION_REQUIRED';
}

/**
 * The prompt for that refusal, shared by the event dialog and its share section. `ask` opens it for
 * such an error, with the server's message, and returns true; confirming calls `resend`, which sends
 * the same write again with `confirmHidesFromCaller`. Any other error returns false, for the caller.
 */
export function useHideFromSaverPrompt(confirmText: string): {
  ask: (err: unknown, resend: () => void) => boolean;
  prompt: ReactNode;
} {
  const [refused, setRefused] = useState<{ message: string; resend: () => void } | null>(null);

  const ask = (err: unknown, resend: () => void): boolean => {
    if (!isHideFromSaverRefusal(err)) return false;
    setRefused({ message: err.message, resend });
    return true;
  };

  const prompt = (
    <ConfirmDialog
      open={refused !== null}
      onOpenChange={v => { if (!v) setRefused(null); }}
      title="L'evento sparirà dal tuo calendario"
      description={refused?.message ?? ''}
      confirmText={confirmText}
      actionType="warning"
      onConfirm={() => refused?.resend()}
    />
  );

  return { ask, prompt };
}
