import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { AUTH_UNAVAILABLE_MESSAGE } from '@luke/core';

import { ChangePasswordCard } from '../ChangePasswordCard';

/** A change refused because sign-in is unavailable shows the sign-in text, not maintenance. */

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

test('SERVICE_UNAVAILABLE shows the sign-in unavailable text', async () => {
  await render(<ChangePasswordCard alsoLdap={false} />);

  h.onError?.({ message: 'masked', data: { code: 'SERVICE_UNAVAILABLE' } });

  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(AUTH_UNAVAILABLE_MESSAGE));
});
