import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { AUTH_UNAVAILABLE_MESSAGE, SERVICE_UNAVAILABLE_MESSAGES } from '@luke/core';

import { ChangePasswordCard } from '../ChangePasswordCard';

/**
 * A change refused with SERVICE_UNAVAILABLE shows the text of the reason the server sends (#259); a
 * wrong current password shows the server's words and never signs out; an ended session is left to
 * the global sign-out (ADR-052).
 */

const h = vi.hoisted((): { onError?: (error: unknown) => void } => ({}));

vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    me: {
      changePassword: {
        useMutation: (options: { onError: (error: unknown) => void }) => {
          h.onError = options.onError;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
  },
}));
vi.mock('../../../../../hooks/usePasswordValidation', () => ({ usePasswordPolicy: () => undefined }));
vi.mock('../../../../../components/PasswordValidationIndicators', () => ({ PasswordValidationIndicators: () => null }));
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  vi.clearAllMocks();
});

test.each([
  ['auth_unavailable', AUTH_UNAVAILABLE_MESSAGE],
  ['maintenance', SERVICE_UNAVAILABLE_MESSAGES.maintenance],
] as const)('SERVICE_UNAVAILABLE for %s shows its text', async (unavailableReason, text) => {
  await render(<ChangePasswordCard alsoLdap={false} />);

  h.onError?.({ message: 'masked', data: { code: 'SERVICE_UNAVAILABLE', unavailableReason } });

  expect(toast.error).toHaveBeenCalledWith(`Errore nel cambio password: ${text}`);
});

test('a wrong current password shows the server\'s words, not an expired session', async () => {
  await render(<ChangePasswordCard alsoLdap={false} />);

  h.onError?.({ message: 'Password corrente non valida', data: { code: 'UNAUTHORIZED' } });

  expect(toast.error).toHaveBeenCalledWith('Errore nel cambio password: Password corrente non valida');
});

test('an ended session shows nothing here: the global handler signs out', async () => {
  await render(<ChangePasswordCard alsoLdap={false} />);

  h.onError?.(
    TRPCClientError.from({ error: { message: 'Sessione non più valida', code: -32001, data: { code: 'UNAUTHORIZED', sessionEnded: true } } } as never) // The shape a response carries; `from` takes it as is.
  );

  expect(toast.error).not.toHaveBeenCalled();
});
