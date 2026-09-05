import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Separate from `vitest.browser.config.mts` on purpose: this project runs its (narrow) set of
 * tests twice, once per named instance below, each in a **real Chromium launched with a specific
 * `timezoneId`** — Playwright's per-context timezone override.
 *
 * `process.env.TZ` genuinely does reach the launched browser too (Playwright spawns Chromium as a
 * child process inheriting the parent's environment, and Chromium falls back to the system/`TZ`
 * zone when no explicit context override is set — confirmed by launching this project's default,
 * un-overridden instance under `TZ=America/Los_Angeles` and observing
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` report it back). That is a real mechanism,
 * just not this file's reason for existing: `TZ` is one *global* value per `vitest run` invocation,
 * so covering both a positive and a negative UTC offset with it would take two separate process
 * invocations (two different `TZ=... vitest run` commands, with someone remembering to run both,
 * every time). Playwright's per-instance `timezoneId` instead runs both offset directions inside
 * ONE `vitest run` / one CI step, deterministically, regardless of whatever the host or CI runner's
 * own ambient `TZ` happens to be set to (or left unset — frequently UTC by default, which is
 * exactly the zone where a local-vs-UTC serialization bug is invisible on both directions at once).
 * `Europe/Rome` (positive UTC offset) and `America/Los_Angeles` (negative UTC offset) were chosen
 * because that class of bug shows up in exactly one direction per offset sign — a suite that only
 * ran under one of them would not have caught the regression this project exists to pin down.
 *
 * Getting the per-instance override right took a few failed shapes: a flat `context` or
 * `contextOptions` key on the instance object is silently ignored (every instance still launches
 * under whatever the top-level default is) — the working shape is a **separate `provider:
 * playwright({ contextOptions: {...} })` call per instance**, confirmed by observing
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` actually differ between instances before
 * committing to this shape.
 */
export default defineConfig({
  optimizeDeps: {
    // Same requirement as the main browser config (see its own comment): on a cold `.vite`
    // cache, a dependency discovered mid-run instead of pre-bundled up front makes Vite reload
    // the whole test mid-flight, and `vi.mock('next/navigation', ...)` only reliably intercepts
    // the module when it's pre-bundled ahead of the mocking call.
    // 'zod' isn't imported directly by this test file, but `../utils` pulls in `@luke/core`,
    // which does — on a truly cold cache (no prior run of any config in this package) it's
    // discovered mid-run rather than pre-bundled, triggering the same "unexpectedly reloaded a
    // test" failure this whole list exists to avoid.
    //
    // The '@dnd-kit'/'@radix-ui'/... group was added for
    // CalendarEventMonthView.timezone.browser.test.tsx, which mounts the real
    // `CalendarEventMonthView` (DndContext + Popover) rather than only a hook — same "discovered
    // mid-run instead of before it" failure mode as 'zod' above, on a cold `.vite` cache.
    // '@radix-ui/react-label' was added for EventTimelineDrag.timezone.browser.test.tsx, same reason.
    include: [
      'vitest-browser-react', 'react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client', 'next/navigation', 'zod',
      '@dnd-kit/core', '@radix-ui/react-popover', '@radix-ui/react-slot', '@radix-ui/react-label', 'class-variance-authority', 'clsx', 'lucide-react', 'tailwind-merge',
    ],
  },
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    include: ['src/**/*.timezone.browser.test.tsx'],
    browser: {
      enabled: true,
      headless: true,
      instances: [
        { browser: 'chromium', name: 'tz-europe-rome', provider: playwright({ contextOptions: { timezoneId: 'Europe/Rome' } }) },
        { browser: 'chromium', name: 'tz-america-los_angeles', provider: playwright({ contextOptions: { timezoneId: 'America/Los_Angeles' } }) },
      ],
      // Same reasoning as the main browser config: keep failure screenshots out of `src/`.
      screenshotDirectory: '.vitest-attachments/screenshots',
    },
  },
});
