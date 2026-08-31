import { type ReactNode } from 'react';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { PermissionButton } from '../PermissionButton';
import { PermissionTooltip } from '../PermissionTooltip';
import { TooltipProvider } from '../ui/tooltip';

/**
 * CLAUDE.md requires that a control disabled by a missing permission still
 * explains itself, and that the explanation is reachable by keyboard. Both
 * components solve that the same way: a disabled element emits neither
 * `pointerenter` nor `focus` and `Tab` skips it, so the tooltip hangs off a
 * focusable `<span>` wrapper instead.
 *
 * `@luke/no-unreachable-disabled-tooltip` already guards the *shape* — that
 * nobody hand-rolls the wrapper and drops the `tabIndex`. What no lint rule can
 * establish is the *behavior*: that the span is genuinely in the tab order and
 * that focusing it actually surfaces the message. That needs a real browser,
 * a real Radix portal and real focus.
 *
 * `delayDuration={0}` is a harness concession: the production provider waits
 * before opening, and waiting out a timer would only make the suite slower
 * without testing anything the delay owns.
 */
function withTooltips(ui: ReactNode) {
  return <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>;
}

test('a denied button is disabled, keyboard reachable, and says why on focus', async () => {
  const screen = await render(
    withTooltips(
      <PermissionButton hasPermission={false} tooltip="Non hai il permesso di eliminare">
        Elimina
      </PermissionButton>
    )
  );

  await expect.element(screen.getByRole('button', { name: 'Elimina' })).toBeDisabled();

  // The wrapper, not the button, is what Tab can land on.
  const wrapper = screen.container.querySelector('span[tabindex="0"]');
  expect(wrapper).not.toBeNull();

  (wrapper as HTMLElement).focus();
  expect(document.activeElement).toBe(wrapper);

  // Focus alone — no pointer — must surface the explanation.
  await expect
    .element(screen.getByText('Non hai il permesso di eliminare'))
    .toBeVisible();
});

test('a permitted button with no infoTooltip adds no wrapper and no extra tab stop', async () => {
  const screen = await render(
    withTooltips(
      <PermissionButton hasPermission tooltip="unused">
        Salva
      </PermissionButton>
    )
  );

  await expect.element(screen.getByRole('button', { name: 'Salva' })).toBeEnabled();
  expect(screen.container.querySelector('span[tabindex]')).toBeNull();
});

test('a permitted, enabled button with infoTooltip does not duplicate the tab stop', async () => {
  const screen = await render(
    withTooltips(
      <PermissionButton hasPermission tooltip="unused" infoTooltip="Esporta in Excel">
        <span aria-hidden>icon</span>
      </PermissionButton>
    )
  );

  // The button is its own tab stop already, so the wrapper must stay out of the
  // tab order — tabIndex is -1 while the button is enabled.
  expect(screen.container.querySelector('span[tabindex="0"]')).toBeNull();
  expect(screen.container.querySelector('span[tabindex="-1"]')).not.toBeNull();
});

test('PermissionTooltip renders children untouched when the permission is there', async () => {
  const screen = await render(
    withTooltips(
      <PermissionTooltip hasPermission tooltip="unused">
        <button type="button">Rinomina</button>
      </PermissionTooltip>
    )
  );

  await expect.element(screen.getByRole('button', { name: 'Rinomina' })).toBeVisible();
  expect(screen.container.querySelector('span[tabindex]')).toBeNull();
});

test('PermissionTooltip wraps a denied non-Button control in a focusable span', async () => {
  const screen = await render(
    withTooltips(
      <PermissionTooltip hasPermission={false} tooltip="Permesso mancante">
        <input type="checkbox" disabled />
      </PermissionTooltip>
    )
  );

  const wrapper = screen.container.querySelector('span[tabindex="0"]');
  expect(wrapper).not.toBeNull();

  (wrapper as HTMLElement).focus();
  await expect.element(screen.getByText('Permesso mancante')).toBeVisible();
});
