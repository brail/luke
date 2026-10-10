import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { SettingsFormShell } from '../SettingsFormShell';

/**
 * A settings form edits what was read, so the shell shows it only with the stored data: a read
 * that failed — reported or not — offering the form would save its placeholders over the stored
 * configuration.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const form = <button type="submit">Salva</button>;
const shell = (props: { isPending: boolean; error: unknown; hasData: boolean; onRetry?: () => void }) => (
  <SettingsFormShell title="Configurazione" onRetry={vi.fn()} {...props}>{form}</SettingsFormShell>
);

test.each([
  ['a failed read', new Error('rete'), 'rete'],
  ['no data and no error reported', null, 'Errore nel caricamento'],
])('%s shows the error and a retry, and no form', async (_, error, text) => {
  const onRetry = vi.fn();
  const screen = await render(shell({ isPending: false, error, hasData: false, onRetry }));

  await expect.element(screen.getByText(text)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Salva' }).elements()).toHaveLength(0);
  await screen.getByRole('button', { name: 'Riprova' }).click();
  expect(onRetry).toHaveBeenCalledOnce();
});

test('a pending read shows no form', async () => {
  const screen = await render(shell({ isPending: true, error: null, hasData: false }));

  await expect.element(screen.getByText('Caricamento configurazione...')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Salva' }).elements()).toHaveLength(0);
});

test('the stored data shows the form', async () => {
  const screen = await render(shell({ isPending: false, error: null, hasData: true }));

  await expect.element(screen.getByRole('button', { name: 'Salva' })).toBeVisible();
});
