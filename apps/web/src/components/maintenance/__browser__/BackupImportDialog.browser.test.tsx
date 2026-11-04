import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { BackupImportDialog } from '../BackupImportDialog';

/**
 * A failed import left the dialog open with its fields filled in and the error only in a toast,
 * so a toast that vanished unread made the import look as if it had started over (#197).
 */

interface Reply {
  event: 'load' | 'error';
  status: number;
  responseText: string;
}

let reply: Reply = { event: 'load', status: 0, responseText: '' };

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 'token-1' } }) }));

/** Answers every send with `reply`, as the browser would once the upload is done. */
class FakeXhr {
  status = 0;
  responseText = '';
  upload = { addEventListener: () => undefined };
  private listeners = new Map<string, () => void>();
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
  open() {}
  setRequestHeader() {}
  send() {
    queueMicrotask(() => {
      this.status = reply.status;
      this.responseText = reply.responseText;
      this.listeners.get(reply.event)?.();
    });
  }
}

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function importPackage() {
  const onOpenChange = vi.fn();
  const screen = await render(<BackupImportDialog open onOpenChange={onOpenChange} onImported={vi.fn()} />);
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]');
  if (!input) throw new Error('file input not found');
  await userEvent.upload(input, new File(['package'], 'backup.lukebak'));
  await screen.getByLabelText('Passphrase').fill('a passphrase');
  await screen.getByRole('button', { name: 'Importa' }).click();
  return { screen, onOpenChange };
}

test.each([
  ['the server message', { event: 'load', status: 400, responseText: '{"message":"Passphrase errata o file non valido"}' }, 'Passphrase errata o file non valido'],
  ['the status of a page that is not JSON', { event: 'load', status: 502, responseText: '<html>Bad Gateway</html>' }, 'Import fallito (502)'],
  ['a network error', { event: 'error', status: 0, responseText: '' }, "Errore di rete durante l'import"],
] satisfies [string, Reply, string][])('a failed import shows %s in the dialog', async (_case, failure, message) => {
  reply = failure;

  const { screen, onOpenChange } = await importPackage();

  await expect.element(screen.getByRole('alert')).toHaveTextContent(message);
  expect(onOpenChange).not.toHaveBeenCalled();
});
