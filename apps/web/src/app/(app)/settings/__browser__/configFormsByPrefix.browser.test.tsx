import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import MailPage from '../mail/page';
import NavSettingsPage from '../nav/page';

/**
 * The mail and NAV forms read the first 100 config rows and looked their keys up in them: with more
 * rows than that (93 registry keys today) they opened blank. They now ask for their own prefix.
 */

const h = vi.hoisted(() => ({ baseUrlFails: false }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin' }, accessToken: 't' } }),
}));
vi.mock('../../../../lib/trpc', () => {
  const mutation = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  const saved: Record<string, { key: string; valuePreview: string }[]> = {
    smtp: [
      { key: 'smtp.host', valuePreview: 'smtp.example.test' },
      { key: 'smtp.port', valuePreview: '2525' },
    ],
    'integrations.nav': [
      { key: 'integrations.nav.host', valuePreview: 'nav.example.test' },
      { key: 'integrations.nav.port', valuePreview: '1533' },
    ],
  };
  // Without a prefix, the first page holds 100 other rows, as on an install with many keys.
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ key: `app.other${i}`, valuePreview: 'x' }));
  // One object per query, as React Query keeps it: the pages reset their form when `data` changes.
  const pages = Object.fromEntries(
    [...Object.entries(saved), ['', firstPage] as const].map(([category, items]) => [
      category,
      { data: { items }, isLoading: false },
    ])
  );
  const baseUrl = { data: [{ key: 'app.baseUrl', value: 'https://luke.example.test', found: true }], isLoading: false };
  const baseUrlFailed = { data: undefined, isLoading: false };
  const utils = { config: { invalidate: vi.fn() } };
  return {
    trpc: {
      useUtils: () => utils,
      config: {
        list: {
          useQuery: (input: { category?: string }) => pages[input.category ?? ''],
        },
        getMultiple: {
          useQuery: () => (h.baseUrlFails ? baseUrlFailed : baseUrl),
        },
      },
      integrations: {
        mail: { saveConfig: mutation, test: mutation },
        nav: { saveConfig: mutation, testConnection: mutation },
      },
    },
  };
});

afterEach(() => {
  h.baseUrlFails = false;
});

test('the mail form shows the saved SMTP server', async () => {
  const screen = await render(<MailPage />);

  await expect.element(screen.getByLabelText(/^Host SMTP/)).toHaveValue('smtp.example.test');
  await expect.element(screen.getByLabelText(/^Porta/)).toHaveValue(2525);
});

test('the NAV form shows the saved server', async () => {
  const screen = await render(<NavSettingsPage />);

  await expect.element(screen.getByLabelText(/^Host/)).toHaveValue('nav.example.test');
  await expect.element(screen.getByLabelText(/^Porta/)).toHaveValue(1533);
});

test('the mail form fills in even when the base URL cannot be read', async () => {
  h.baseUrlFails = true;
  const screen = await render(<MailPage />);

  await expect.element(screen.getByLabelText(/^Host SMTP/)).toHaveValue('smtp.example.test');
});
