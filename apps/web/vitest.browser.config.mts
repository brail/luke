import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Browser tier: React components and hooks exercised in a real Chromium.
 *
 * Separate from `vitest.config.mts` on purpose. That project is Node-only and
 * deliberately restricted to pure modules under `src/lib/`; it is what
 * `pnpm test` and `.husky/pre-push` run, and it must stay fast enough that
 * neither has to provision a browser. This project is opt-in, has its own
 * script, and runs in its own CI job.
 *
 * What it is for is the class of defect the other tiers structurally cannot
 * see: focus and tab order, Radix portals, whether a click actually reaches a
 * submit handler. `lessons.md` records a dialog whose submit button never fired
 * because Radix unmounted it mid-click — typecheck, lint and the whole suite
 * were green, and a human found it by clicking.
 *
 * ## Why `oxc.jsx` and not a React plugin
 *
 * The workspace TypeScript config sets `jsx: preserve`, which is correct for
 * Next but leaves JSX untransformed for anything else that reads it. Vite 8
 * transforms with **oxc**, so the fix belongs there.
 *
 * `esbuild.jsx` was tried first and Vite reported it back as ignored — oxc wins
 * when both are set — and removing it entirely broke the import, which is how
 * we know the setting is load-bearing rather than decorative. One option in the
 * right namespace is enough: `@vitejs/plugin-react` is **not** required here,
 * and was not installed. Its Fast Refresh is worthless to a test run.
 */
export default defineConfig({
  // `@luke/core` publishes CommonJS while its `exports.import` points at that
  // same file, so a browser ESM context cannot take named imports from it —
  // Next bundles around it and Node `require`s it, which is why nothing had
  // noticed. Pre-bundling converts it once here. Deciding the package's real
  // module format is a separate platform question and is not settled from a
  // test config.
  optimizeDeps: {
    include: [
      '@luke/core',
      'vitest-browser-react',
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/client',
      'react-hook-form',
      '@hookform/resolvers/zod',
      'zod',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-label',
      '@radix-ui/react-slot',
      'lucide-react',
      'class-variance-authority',
      'clsx',
      'tailwind-merge',
    ],
  },
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    include: ['src/**/*.browser.test.tsx'],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      headless: true,
      // Failure screenshots are debug artifacts, not fixtures. Default they
      // land in a `__screenshots__` directory beside the spec, inside `src/`;
      // send them to the ignored attachments directory so a red run never
      // leaves untracked binaries in the source tree.
      screenshotDirectory: '.vitest-attachments/screenshots',
    },
  },
});
