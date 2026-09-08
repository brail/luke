import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { AppVersionLabel } from '../AppVersionLabel';

/**
 * Behavioral coverage that `AppVersionLabel` delegates, rather than deciding anything itself.
 *
 * The three display rules live in `src/lib/appVersion.ts` and are proved there, in the node tier,
 * where the environment can actually be moved. What that tier structurally cannot see is whether
 * the component still *asks* — a component that went back to reading
 * `process.env.NEXT_PUBLIC_APP_VERSION` and composing the development marker itself would keep
 * every helper test green while rendering something else entirely.
 *
 * So the helper module is mocked and the component is rendered for real: what reaches the DOM must
 * be exactly what `appVersionText()` returned, and `appVersionLabel()` — the About page's entry
 * point, which composes no development marker — must not be what this component renders.
 */
vi.mock('../../lib/appVersion', () => ({
  appVersionText: vi.fn(),
  appVersionLabel: vi.fn(),
}));

const { appVersionText, appVersionLabel } = await import('../../lib/appVersion');
const mockedText = vi.mocked(appVersionText);
const mockedLabel = vi.mocked(appVersionLabel);

test('renders exactly what appVersionText returns, composed marker included', async () => {
  mockedText.mockReturnValue('v3.0.0-rc.1 · development');
  mockedLabel.mockReturnValue('LABEL-NOT-USED-HERE');

  const screen = await render(<AppVersionLabel className="footer" />);

  await expect.element(screen.getByText('v3.0.0-rc.1 · development')).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain('LABEL-NOT-USED-HERE');
  expect(mockedText).toHaveBeenCalled();
});

test('renders the development marker alone when the build carries no release identity', async () => {
  // The regression this exists for: `pnpm dev` sets no NEXT_PUBLIC_APP_VERSION, and a component
  // that guarded the marker behind the version would drop it exactly there.
  mockedText.mockReturnValue('development');

  const screen = await render(<AppVersionLabel />);

  await expect.element(screen.getByText('development')).toBeInTheDocument();
});

test('renders nothing at all when there is nothing to say', async () => {
  mockedText.mockReturnValue(null);

  const screen = await render(<AppVersionLabel />);

  expect(screen.container.textContent).toBe('');
});
