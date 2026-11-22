import { expect, vi } from 'vitest';

import type { Locator } from 'vitest/browser';

/**
 * Asserts that activating `control` submits the sign-out form natively: a POST to
 * `/api/auth/logout` (#238). The submission is caught before the browser navigates away.
 *
 * @param activate - How the control is activated; a click by default.
 */
export async function expectSubmitsSignOut(control: Locator, activate: () => Promise<unknown> = () => control.click()) {
  const submitted: HTMLFormElement[] = [];
  const capture = (event: SubmitEvent) => {
    event.preventDefault();
    if (event.target instanceof HTMLFormElement) submitted.push(event.target);
  };
  document.addEventListener('submit', capture, true);
  try {
    await activate();
    await vi.waitFor(() => expect(submitted).toHaveLength(1));
  } finally {
    document.removeEventListener('submit', capture, true);
  }
  expect(submitted[0].method).toBe('post');
  expect(new URL(submitted[0].action).pathname).toBe('/api/auth/logout');
}
