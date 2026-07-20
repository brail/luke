import { readFileSync } from 'fs';
import { join } from 'path';

import { z } from 'zod';

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
  about: protectedProcedure.query(() => ({
    version: info.version,
    nodeVersion: process.version,
    deps: info.deps,
  })),

  triggerCalendarDigest: protectedProcedure
    .use(requirePermission('config:update'))
    .input(z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ input, ctx }) => {
      const range = {
        start: new Date(`${input.from}T00:00:00`),
        end: new Date(new Date(`${input.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000),
      };
      await runDigestNow(ctx.prisma, ctx.logger, range, ctx.session.user.id);
      return { ok: true };
    }),
});
