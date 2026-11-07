import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { CalendarEventShareSection } from '../CalendarEventShareSection';

/**
 * Revoking one's own grant when it is the last way to the event: the server refuses it until
 * confirmed (#199), the section asks, and a confirmed revoke tells the dialog the user lost access.
 */

const HIDDEN_MESSAGE =
  "Così l'evento non comparirà nel tuo calendario: non fai parte di nessuna delle sue funzioni e non ti è condiviso.";
const ME = '00000000-0000-4000-8000-0000000000aa';

const h = vi.hoisted(() => ({
  revokeMock: vi.fn(),
  toastError: vi.fn(),
  candidates: {
    data: [
      {
        id: '00000000-0000-4000-8000-0000000000aa',
        firstName: 'Io',
        lastName: 'Stesso',
        username: 'io',
        alreadyGranted: true,
      },
    ],
    isLoading: false,
    error: null,
  },
}));

type RevokeVariables = { userIds: string[]; confirmHidesFromCaller?: boolean };

vi.mock('../../../../../lib/trpc', async () => {
  const { TRPCClientError } = await import('@trpc/client');
  // `TRPCClientError` keeps the response shape it is given; the prompt reads only `data.code`.
  const refusal = () =>
    TRPCClientError.from({
      error: {
        code: -1,
        message: HIDDEN_MESSAGE,
        data: { code: 'PRECONDITION_REQUIRED' },
      },
    } as never);
  return {
    trpc: {
      seasonCalendar: {
        listGrantCandidates: { useQuery: () => h.candidates },
        grantUserVisibility: {
          useMutation: () => ({
            mutateAsync: async () => undefined,
            isPending: false,
          }),
        },
        revokeUserVisibility: {
          // Answers as the server does: an unconfirmed revoke of one's own last grant is refused.
          useMutation: () => ({
            mutateAsync: async (variables: RevokeVariables) => {
              h.revokeMock(variables);
              if (!variables.confirmHidesFromCaller) throw refusal();
            },
            isPending: false,
          }),
        },
      },
      useUtils: () => ({
        seasonCalendar: {
          listGrantCandidates: { invalidate: async () => {} },
          listMilestones: { invalidate: async () => {} },
        },
      }),
    },
  };
});
vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }));

afterEach(() => {
  h.revokeMock.mockReset();
  h.toastError.mockReset();
});

async function revokeOwnGrant(onLostAccess: () => void) {
  const screen = await render(
    <CalendarEventShareSection eventId="e1" onLostAccess={onLostAccess} />
  );
  await screen.getByRole('checkbox').click();
  await screen.getByRole('button', { name: 'Salva condivisioni' }).click();
  await expect.element(screen.getByText(HIDDEN_MESSAGE)).toBeVisible();
  return screen;
}

test("revoking one's own last grant asks first, without an error toast", async () => {
  await revokeOwnGrant(vi.fn());

  expect(h.revokeMock).toHaveBeenCalledWith({ eventId: 'e1', userIds: [ME] });
  expect(h.toastError).not.toHaveBeenCalled();
});

test('confirming revokes it, marked as confirmed, and reports the lost access', async () => {
  const onLostAccess = vi.fn();
  const screen = await revokeOwnGrant(onLostAccess);

  await screen.getByRole('button', { name: 'Revoca comunque' }).click();

  await expect.poll(() => onLostAccess.mock.calls.length).toBe(1);
  expect(h.revokeMock).toHaveBeenLastCalledWith({
    eventId: 'e1',
    userIds: [ME],
    confirmHidesFromCaller: true,
  });
});

test('Annulla revokes nothing more', async () => {
  const onLostAccess = vi.fn();
  const screen = await revokeOwnGrant(onLostAccess);

  await screen.getByRole('button', { name: 'Annulla' }).click();

  await expect
    .element(screen.getByText(HIDDEN_MESSAGE))
    .not.toBeInTheDocument();
  expect(h.revokeMock).toHaveBeenCalledTimes(1);
  expect(onLostAccess).not.toHaveBeenCalled();
});
