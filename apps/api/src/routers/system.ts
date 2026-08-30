import { readFileSync } from 'fs';
import { join } from 'path';

import { CalendarDigestRangeInputSchema } from '@luke/core';

import { runDigestNow } from '../lib/calendarDigestScheduler';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

const BACKEND_DEP_KEYS = [
  'fastify',
  '@trpc/server',
  '@prisma/client',
  'zod',
  'pino',
  'argon2',
  'mssql',
  'nodemailer',
  'next-auth',
];

function strip(v: string) {
  return v.replace(/^[\^~>=<]+/, '');
}

function buildInfo() {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      version?: string;
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    return {
      version: pkg.version ?? 'unknown',
      deps: BACKEND_DEP_KEYS
        .filter(k => k in deps)
        .map(k => ({ name: k, version: strip(deps[k]) })),
    };
  } catch {
    return { version: 'unknown', deps: [] };
  }
}

const info = buildInfo();

export const systemRouter = router({
  /**
   * Backend build/runtime info for the settings "About" panel: app version (from
   * `package.json`), Node.js version, and a curated subset of backend dependency versions.
   *
   * @auth {authenticated}
   * @input {none}
   * @output {{ version: string, nodeVersion: string, deps: { name: string, version: string }[] }}
   */
  about: protectedProcedure.query(() => ({
    version: info.version,
    nodeVersion: process.version,
    deps: info.deps,
  })),

  /**
   * Manually triggers the calendar phase-alert digest email for a given date range, outside its
   * normal cron schedule — used for testing/re-sending. See `runDigestNow`.
   *
   * @auth {season_calendar:read}
   * @input {CalendarDigestRangeInputSchema} — inclusive date range as `YYYY-MM-DD` strings.
   * @output {{ ok: true }}
   */
  triggerCalendarDigest: protectedProcedure
    // Re-sending your own calendar digest is a calendar action, not a configuration change. It was
    // the only legitimate editor flow behind `config:update`.
    .use(requirePermission('season_calendar:read'))
    .input(CalendarDigestRangeInputSchema)
    .mutation(async ({ input, ctx }) => {
      const range = {
        start: new Date(`${input.from}T00:00:00`),
        end: new Date(new Date(`${input.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000),
      };
      await runDigestNow(ctx.prisma, ctx.logger, range, ctx.session.user.id);
      return { ok: true };
    }),
});
