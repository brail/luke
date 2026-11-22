/**
 * Next.js server-start hook. Refuses a production start of the Node.js server when
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` turns TLS certificate verification off by default, as apps/api
 * does; warns elsewhere. The rule and its message live in `@luke/core`; the start window before
 * `register()` ends is ADR-046's.
 */

import { isProduction, tlsVerificationOffProblem } from '@luke/core';

import { debugWarn } from './lib/debug';

export async function register(): Promise<void> {
  // nosemgrep: luke-no-direct-env -- Next's runtime marker, set by the framework, not configuration
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // nosemgrep: luke-no-direct-env -- the check reads one bootstrap variable from the environment it is given
    const problem = tlsVerificationOffProblem(process.env);
    if (!problem) return;

    // `NODE_ENV` is fixed when the image is built: a production image always refuses.
    if (isProduction()) {
      // nosemgrep: luke-no-console -- the refusal must reach the production log, where `debugError` is silent
      console.error(`[env-policy] ${problem}`);
      // A throw would not stop the server: Next logs a rejected `register()` and keeps listening.
      process.exit(1);
    }
    debugWarn(`[env-policy] ${problem}`);
  }
}
