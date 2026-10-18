import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import AboutPage from '../page';

/**
 * Behavioral coverage that the About badge delegates to `appVersionLabel()`.
 *
 * The page renders the version in its own Badge, next to a separate `development` Badge it owns, so
 * it deliberately consumes `appVersionLabel()` (version only) rather than `appVersionText()` (the
 * composed sidebar line). It used to write `v{process.env.NEXT_PUBLIC_APP_VERSION}` inline, which
 * is how it rendered a bare `v` on any build that carried no release identity, and how a second `v`
 * could be prepended on top of a value that already had one.
 */
// `next/image` reaches for `process` at import time, which does not exist in the browser bundle.
// Shimmed here, in this file, rather than by teaching the shared browser config about Next. The
// shim renders nothing: the image is scenery for this test, the badge beside it is the subject, and
// a stand-in `<img>` would only trip `@next/next/no-img-element` for no gain.
vi.mock('next/image', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('../../../../lib/appVersion', () => ({
  appVersionLabel: vi.fn(),
  appVersionText: vi.fn(),
}));

const { appVersionLabel } = await import('../../../../lib/appVersion');
const mockedLabel = vi.mocked(appVersionLabel);

test('renders the badge with exactly what appVersionLabel returns, and adds no v of its own', async () => {
  mockedLabel.mockReturnValue('v3.0.0-rc.1');

  const screen = await render(<AboutPage />);

  await expect.element(screen.getByText('v3.0.0-rc.1')).toBeInTheDocument();
  expect(screen.container.textContent).not.toContain('vv3.0.0-rc.1');
  expect(mockedLabel).toHaveBeenCalled();
});

test('renders no version badge when the build carries no release identity', async () => {
  // Not a bare `v`: the inline read used to render the prefix with nothing after it.
  mockedLabel.mockReturnValue(null);

  const screen = await render(<AboutPage />);

  const badges = [...screen.container.querySelectorAll('*')]
    .map(node => node.textContent?.trim())
    .filter(text => text === 'v' || text === 'vundefined');
  expect(badges).toEqual([]);
});
