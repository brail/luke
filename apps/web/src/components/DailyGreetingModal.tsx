'use client';

import { useDailyGreeting } from '../hooks/useDailyGreeting';

import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

/**
 * Fullscreen once-a-day greeting modal: time-based salutation plus a random quote or fact.
 * Rendering is gated entirely by `useDailyGreeting` — mount unconditionally in the app layout.
 */
export function DailyGreetingModal() {
  const { shouldShow, data, dismiss } = useDailyGreeting();

  if (!shouldShow || !data) {
    return null;
  }

  return (
    <Dialog open onOpenChange={open => !open && dismiss()}>
      <DialogContent className="flex h-screen w-screen max-w-none translate-x-0 translate-y-0 top-0 left-0 flex-col items-center justify-center gap-8 rounded-none border-0 p-8 text-center">
        <div className="max-w-2xl space-y-3">
          <h1 className="text-3xl font-semibold">
            {data.greeting} {data.userName}, {data.intro}
          </h1>
        </div>

        <div className="max-w-xl space-y-2">
          <p className="text-xl italic text-muted-foreground">&ldquo;{data.content}&rdquo;</p>
          {data.type === 'quote' && data.author && (
            <p className="text-sm italic text-muted-foreground">— {data.author}</p>
          )}
          {data.type === 'fact' && (
            <p className="text-sm text-muted-foreground">Curiosità del giorno</p>
          )}
        </div>

        <Button size="lg" onClick={dismiss}>
          Iniziamo
        </Button>
      </DialogContent>
    </Dialog>
  );
}
