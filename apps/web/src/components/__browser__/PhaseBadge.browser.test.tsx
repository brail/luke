import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { PhaseBadge } from '../PhaseBadge';

/**
 * A phase badge always writes the phase name, in the phase's colour when it has one from the
 * palette; no colour, or a stored value outside the palette, gives the neutral badge (#158).
 */

test('draws a palette colour with the phase name on it', async () => {
  const screen = await render(<PhaseBadge label="Prototipo" color="teal" />);

  await expect.element(screen.getByText('Prototipo')).toHaveClass('bg-teal-100', 'dark:bg-teal-900');
});

test.each([null, 'red'])('falls back to the neutral badge for the stored colour %s', async color => {
  const screen = await render(<PhaseBadge label="Design" color={color} />);

  await expect.element(screen.getByText('Design')).toHaveClass('bg-muted', 'text-muted-foreground');
});
