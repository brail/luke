import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { AUTH_UNAVAILABLE_MESSAGE, SERVICE_UNAVAILABLE_MESSAGES } from '@luke/core';

import { ChangePasswordCard } from '../ChangePasswordCard';

/** A change refused with SERVICE_UNAVAILABLE shows the text of the reason the server sends (#259). */

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

test.each([
  ['auth_unavailable', AUTH_UNAVAILABLE_MESSAGE],
  ['maintenance', SERVICE_UNAVAILABLE_MESSAGES.maintenance],
] as const)('SERVICE_UNAVAILABLE for %s shows its text', async (unavailableReason, text) => {
  await render(<ChangePasswordCard alsoLdap={false} />);

  h.onError?.({ message: 'masked', data: { code: 'SERVICE_UNAVAILABLE', unavailableReason } });

  expect(toast.error).toHaveBeenCalledWith(`Errore nel cambio password: ${text}`);
});
