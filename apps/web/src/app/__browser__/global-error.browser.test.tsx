import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import GlobalError from '../global-error';

/**
 * The global error page replaces the root layout: no providers, possibly no working client runtime.
 * Its `Esci` must therefore be a sign-out form in the server-rendered HTML itself, which a browser
 * submits without JavaScript (#238). Rendered to markup, not mounted: its `<html>` and `<body>`
 * would take over the test page's own.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

test('the server-rendered page holds a sign-out form', () => {
  const markup = renderToStaticMarkup(<GlobalError error={new Error('failed')} retry={vi.fn()} />);
  const document = new DOMParser().parseFromString(markup, 'text/html');

  const form = document.querySelector('form[method="post"][action="/api/auth/logout"]');
  expect(form?.querySelector('button[type="submit"]')?.textContent).toBe('Esci');
});
