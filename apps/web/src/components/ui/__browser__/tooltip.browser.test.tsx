import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip';

/**
 * `TooltipContent` renders in a portal, outside its trigger's ancestors: in place, an
 * `overflow-hidden` ancestor cut it, and under an `<svg>` it was an SVG node, never painted.
 */

test('the content leaves a clipping ancestor and is painted', async () => {
  const screen = await render(
    <TooltipProvider delayDuration={0}>
      <div data-testid="clip" className="h-6 w-6 overflow-hidden">
        <Tooltip>
          <TooltipTrigger>Info</TooltipTrigger>
          <TooltipContent>Dettagli completi</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );

  await screen.getByRole('button', { name: 'Info' }).hover();

  // The first match is the painted content; Radix repeats it, visually hidden, for screen readers.
  const content = screen.getByText('Dettagli completi').first();
  await expect.element(content).toBeVisible();
  expect(screen.getByTestId('clip').element().contains(content.element())).toBe(false);
});
