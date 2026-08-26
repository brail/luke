/**
 * Luke API server entry point.
 *
 * Bootstraps a Fastify instance with tRPC, Prisma, security plugins, and all upload/export routes.
 * Startup sequence: env-policy guard → DB connection → master key validation → plugin registration
 * → scheduler registration → listen.
 */

import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import Fastify from 'fastify';
import pino from 'pino';

import { isDevelopment, isProduction } from '@luke/core';
import {
  validateMasterKey,
  deriveSecret,
  HKDF_INFO_COOKIE,
} from '@luke/core/server';

import { registerDerivativeScheduler } from './lib/assets/derivativeWorker';
import { registerBackupScheduler } from './lib/backupScheduler';
import { registerCalendarDigestScheduler } from './lib/calendarDigestScheduler';
import { registerCalendarNotificationBuffer } from './lib/calendarNotificationBuffer';
import { getConfig, validateCriticalConfig } from './lib/configManager';
import { buildCorsAllowedOrigins } from './lib/cors';
import { setGlobalErrorHandler } from './lib/error';
import { registerFeedbackSyncScheduler } from './lib/feedbackSyncScheduler';
import { buildHelmetConfig } from './lib/helmet';
import { idempotencyStore } from './lib/idempotency';
import { registerKimoSyncScheduler } from './lib/kimoSyncScheduler';
import { registerMaintenanceModeScheduler } from './lib/maintenanceModeScheduler';
import { registerMilestoneDeadlineScheduler } from './lib/milestoneDeadlineScheduler';
import { registerNavSyncScheduler } from './lib/navSyncScheduler';
import { registerPortafoglioSyncScheduler } from './lib/portafoglioSyncScheduler';
import { rateLimitStore } from './lib/ratelimit';
import { registerRetentionScheduler } from './lib/retentionScheduler';
import { createContext } from './lib/trpc';
import {
  pinoTraceMiddleware,
  // pinoSerializers,
} from './observability/pinoTrace';
import { runReadinessChecks } from './observability/readiness';
import { storagePlugin } from './plugins/storageUpload';
import { appRouter } from './routers';
import { registerAuditLogExportDownloadRoute } from './routes/auditLogExportDownload';
import { registerBackupDownloadRoute } from './routes/backupDownload';
import { registerBackupExportDownloadRoute } from './routes/backupExportDownload';
import { registerBackupImportRoute } from './routes/backupImport';
import brandLogoRoutes from './routes/brandLogo.routes';
import collectionRowPictureRoutes from './routes/collectionRowPicture.routes';
import companyLogoRoutes from './routes/companyLogo.routes';
import seasonCalendarExportRoutes from './routes/seasonCalendarExport.routes';
import specsheetImageRoutes from './routes/specsheetImage.routes';
import { registerSseRoute } from './routes/sse';
import { getStorageProvider } from './storage';

/** Pino logger configuration: `warn` in production, `info` + pino-pretty in development. */
const loggerConfig = {
  level: isProduction() ? 'warn' : 'info',
  transport: isDevelopment()
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
};

/** Fastify instance shared across all route registrations in this module. */
const fastify = Fastify({
  logger: loggerConfig,
  requestTimeout: 360_000, // 6 min — aligned with Next.js proxyTimeout and the NAV pool (300 s + margin)
  connectionTimeout: 0,    // disabled — requestTimeout handles the total limit
  routerOptions: { maxParamLength: 5000 }, // tRPC batch requests contain multiple procedure names in the URL param
  // apps/api is never directly reachable from the Internet (no port published
  // in docker-compose.prod.yml/rc.yml): the only entry point is the apps/web container,
  // either via next.config.js rewrites or via NextAuth's server-to-server fetch
  // (apps/web/src/auth.ts). Trusting X-Forwarded-For here is therefore safe and necessary
  // so that req.ip resolves to the real client IP instead of the web container's internal
  // address (root cause of the shared rate-limit bucket on /trpc/auth.login).
  // `1` (not `true`): trust exactly one hop (the apps/web container, the only possible
  // sender). `true` trusts an unlimited chain and resolves req.ip to the leftmost
  // entry — i.e. the value a client can self-declare — making every
  // keyBy:'ip' rate-limit bucket bypassable by sending a fake X-Forwarded-For (CRITICAL,
  // audit 2026-08-07). With `1`, apps/api trusts only the direct socket (always apps/web)
  // and reads the entry immediately before it — the one NPM itself appended via
  // $proxy_add_x_forwarded_for, never the one self-declared by the client.
  trustProxy: 1,
});

// Register global handler/onError for logging and a safe response
setGlobalErrorHandler(fastify);

/**
 * Custom JSON content-type parser that accepts `application/json; charset=utf-8` and similar.
 *
 * Fixes tRPC mutations where the framework's default parser rejected the charset suffix,
 * causing input parameters to be silently dropped.
 */
fastify.addContentTypeParser(
  /^application\/json/,
  { parseAs: 'string' },
  (_req, body, done) => {
    try {
      const json = JSON.parse(body as string);
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

/** Prisma client instance using the pg adapter. Shared across all route handlers and services. */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  log: isDevelopment() ? ['query', 'info', 'warn', 'error'] : ['error'],
});

/**
 * Registers security-related Fastify plugins: cookie, rate-limit, helmet, CORS,
 * and the Pino trace-correlation hook.
 */
async function registerSecurityPlugins(): Promise<string[]> {
  // Cookie plugin for session management
  // Secret derived via HKDF-SHA256 from the master key (domain: cookie.secret)
  await fastify.register(cookie, {
    secret: deriveSecret(HKDF_INFO_COOKIE),
  });

  // Global rate limiting (permissive)
  await fastify.register(rateLimit, {
    max: isDevelopment() ? 2000 : 100,
    timeWindow: '1 minute',
    cache: 10000,
    skipOnError: true,
    // In dev, bypass rate limiting for localhost to avoid dev friction
    allowList: isDevelopment() ? ['127.0.0.1', '::1', '::ffff:127.0.0.1'] : [],
    errorResponseBuilder: (request: any, context: any) => ({ // Fastify rate-limit internals lack exported types
      statusCode: 429,
      error: 'Rate limit exceeded',
      message: `Too many requests from ${request.ip}`,
      retryAfter: Math.round(context.ttl / 1000),
    }),
  });

  const envName = isDevelopment() ? 'development' : isProduction() ? 'production' : 'test';

  // Helmet for security headers with a minimal CSP for a JSON-only API.
  //
  // The configuration comes from `lib/helmet.ts`, which declares itself centralized:
  // an inline copy used to live here, and the two had already diverged. The copy
  // passed `dnsPrefetchControl: false`, which in helmet **disables the
  // middleware** instead of setting the header — so the server wasn't sending
  // `X-DNS-Prefetch-Control` at all, while `security.headers.spec.ts` asserted it
  // as `off` against `buildHelmetConfig` and passed. A green test for a
  // nonexistent header.
  await fastify.register(helmet, buildHelmetConfig(envName));

  // Hybrid CORS with priority AppConfig → ENV → default
  const corsConfig = buildCorsAllowedOrigins(envName);

  // Informational CORS log (don't print the full list in prod)
  if (
    corsConfig.source === 'default-prod-deny' &&
    corsConfig.origins.length === 0
  ) {
    fastify.log.info('CORS source=default-prod-deny (no origins configured)');
  } else {
    fastify.log.info(
      `CORS source=${corsConfig.source} (${corsConfig.origins.length} origins)`
    );
  }

  // Register CORS only if there are configured origins or we're in dev
  if (corsConfig.origins.length > 0 || isDevelopment()) {
    await fastify.register(cors, {
      origin: isDevelopment() ? true : corsConfig.origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-luke-trace-id',
        'Accept',
        'Origin',
        'X-Requested-With',
      ],
      exposedHeaders: ['Content-Type', 'x-luke-trace-id'],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    });
  }

  // Middleware for trace ID correlation with Pino logs
  fastify.addHook('onRequest', pinoTraceMiddleware);

  // Rate limiting now handled via per-route tRPC middleware

  // Idempotency is handled at the tRPC middleware level for specific procedures

  return corsConfig.origins;
}

// /**
//  * Registra route OPTIONS per tRPC (gestione CORS preflight)
//  */
// async function _registerTRPCOptions() {
//   // Gestisci richieste OPTIONS per tRPC
//   fastify.options('/trpc/*', async (_request, reply) => {
//     // CORS headers sono già gestiti dal plugin CORS
//     reply.status(204).send();
//   });
// }

/** Registers the tRPC Fastify adapter at the `/trpc` prefix. */
async function registerTRPCPlugin() {
  await fastify.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: async ({ req, res }: any) => // fastify-trpc-plugin adapter types not exported
        createContext({ prisma, req, res }),
      onError: ({ path, error, ctx }: any) => { // fastify-trpc-plugin OnErrorFn type not exported
        const traceId = ctx?.traceId;
        const cause = error.cause; // `error` is already `any` (see comment above) — redundant cast
        fastify.log.error(
          {
            path,
            err: { message: error.message, code: error.code },
            // `cause` is deliberately set on many `INTERNAL_SERVER_ERROR`s
            // (see apps/api/src/lib/ratelimit.ts and others) precisely because
            // otherwise it disappears here: without this field, the real cause
            // never reaches the logs.
            ...(cause !== undefined
              ? { cause: cause instanceof Error ? cause.message : String(cause) }
              : {}),
            traceId,
          },
          'tRPC error'
        );
      },
    },
    // Handle OPTIONS requests for CORS
    useWSS: false,
  });
}

/**
 * Registers `@fastify/multipart` globally with a 50 MB file size limit.
 *
 * This is the maximum allowed by the generic storage upload endpoint. Individual
 * domain services (brand logo, collection pictures, etc.) enforce stricter limits.
 */
async function registerMultipart() {
  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
      files: 1,
    },
  });
}

/** Registers the generic storage upload/download plugin. */
async function registerStoragePlugin() {
  await fastify.register(storagePlugin, { prisma });
}

/** Registers the brand logo upload routes. */
async function registerBrandLogoRoutes() {
  await fastify.register(brandLogoRoutes, { prisma });
}

/** Registers the company logo upload routes. */
async function registerCompanyLogoRoutes() {
  await fastify.register(companyLogoRoutes, { prisma });
}

/** Registers the collection layout row picture upload routes. */
async function registerCollectionRowPictureRoutes() {
  await fastify.register(collectionRowPictureRoutes, { prisma });
}

/** Registers the merchandising specsheet image upload routes. */
async function registerSpecsheetImageRoutes() {
  await fastify.register(specsheetImageRoutes, { prisma });
}

/** Registers the season calendar export routes (iCal, PDF, XLSX). */
async function registerSeasonCalendarExportRoutes() {
  await fastify.register(seasonCalendarExportRoutes, { prisma });
}

/**
 * Registers health and readiness probe routes:
 *  - GET /livez   — liveness (always 200 if the process is running)
 *  - GET /readyz  — readiness (runs all registered checks, 503 if any fail)
 *  - GET /healthz — legacy health endpoint for Portainer and Docker healthcheck
 *  - GET /api/health — detailed health info including uptime and version
 *  - GET /         — root discovery endpoint listing available endpoints
 */
async function registerHealthRoute() {
  // Liveness: process alive (always 200 if the process is alive)
  fastify.get('/livez', async (_request, _reply) => {
    return { status: 'ok' };
  });

  // Readiness: system ready to serve requests
  fastify.get('/readyz', async (_request, reply) => {
    const result = await runReadinessChecks(prisma);

    if (!result.allOk) {
      reply.status(503);
      // Internal log without exposing it in the HTTP response
      fastify.log.warn({ checks: result.checks }, 'Readiness check failed');
    }

    return {
      status: result.allOk ? 'ready' : 'unready',
      timestamp: result.timestamp,
      checks: result.checks, // OK to expose status for K8s debugging
    };
  });

  // Legacy route for backward compatibility
  fastify.get('/healthz', async (_request, _reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/api/health', async (_request, _reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.1.0',
      environment: isDevelopment() ? 'development' : 'production',
    };
  });

  // Root route for compatibility
  fastify.get('/', async (_request, _reply) => {
    return {
      message: 'Luke API is running!',
      version: process.env.npm_package_version || '0.1.0',
      endpoints: {
        health: '/api/health',
        livez: '/livez',
        readyz: '/readyz',
        trpc: '/trpc',
        docs: 'https://trpc.io/docs',
      },
    };
  });

  if (process.env.NODE_ENV === 'test') {
    fastify.get('/__test__/boom', async () => {
      throw new Error('Boom test error');
    });
  }
}

/**
 * Starts a background interval that cleans up unconfirmed (pending) temp files
 * older than 1 hour and orphaned `.tmp` partial files older than 2 hours.
 *
 * Runs immediately on startup, then every 30 minutes. The interval is cleared on server close.
 */
function setupTempFileCleanup() {
  const cleanupInterval = 30 * 60 * 1000; // 30 minutes

  const cleanupTempFiles = async () => {
    try {
      const provider = await getStorageProvider(prisma);

      // Find temp files older than 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const tempFiles = await prisma.fileObject.findMany({
        where: {
          confirmedAt: null,
          // Masters only: a derivative is never independently "pending confirmation" —
          // it lives or dies with its master (onDelete: Cascade). Sweeping it here on its
          // own `confirmedAt`/age would delete its storage object while the FileObject
          // row for the (still-linked) master survives, leaving a dangling reference.
          parentId: null,
          bucket: { in: ['brand-logos', 'company-assets', 'collection-row-pictures', 'merchandising-specsheet-images'] },
          createdAt: { lt: oneHourAgo },
        },
      });

      if (tempFiles.length > 0) {
        fastify.log.info(
          `Cleaning up ${tempFiles.length} temp files older than 1 hour`
        );

        // `deleteMany` on the master below cascades its derivative *rows* for
        // free (onDelete: Cascade), but Postgres cascade never touches the
        // storage provider — a derivative's physical object must be removed
        // here explicitly, or it becomes a permanent orphan on disk/S3. One
        // batched query for every candidate master's derivatives, not one per
        // master — the loop below just looks up its own slice.
        const allDerivatives = await prisma.fileObject.findMany({
          where: { parentId: { in: tempFiles.map(f => f.id) } },
          select: { parentId: true, bucket: true, key: true },
        });
        const derivativesByParent = new Map<string, { bucket: string; key: string }[]>();
        for (const derivative of allDerivatives) {
          const list = derivativesByParent.get(derivative.parentId!) ?? [];
          list.push(derivative);
          derivativesByParent.set(derivative.parentId!, list);
        }

        // Delete physical files first (best-effort), collect succeeded IDs
        const succeededIds: string[] = [];
        for (const file of tempFiles) {
          try {
            let derivativeDeleteFailed = false;
            for (const derivative of derivativesByParent.get(file.id) ?? []) {
              try {
                await provider.delete({
                  bucket: derivative.bucket as 'brand-logos' | 'company-assets' | 'collection-row-pictures' | 'merchandising-specsheet-images',
                  key: derivative.key,
                });
              } catch (err) {
                derivativeDeleteFailed = true;
                fastify.log.warn(
                  { err, fileKey: derivative.key },
                  'Failed to delete derivative file from storage'
                );
              }
            }

            // A derivative stuck on disk/S3 must keep the master's DB row alive too —
            // deleting the master below would cascade its derivative *row* away
            // (onDelete: Cascade) while the physical object survives, turning a
            // retryable failure into a permanent orphan with no reference left to
            // find it by. Skip the whole master this tick; it's retried next tick.
            if (derivativeDeleteFailed) continue;

            await provider.delete({
              bucket: file.bucket as 'brand-logos' | 'company-assets' | 'collection-row-pictures' | 'merchandising-specsheet-images',
              key: file.key,
            });
            succeededIds.push(file.id);
            fastify.log.debug(`Cleaned up temp file: ${file.key}`);
          } catch (err) {
            fastify.log.warn(
              { err, fileKey: file.key },
              'Failed to delete temp file from storage'
            );
          }
        }

        // Batch delete DB records only for files successfully removed from storage.
        // Cascades to each master's derivative rows automatically (onDelete: Cascade).
        if (succeededIds.length > 0) {
          await prisma.fileObject.deleteMany({
            where: { id: { in: succeededIds } },
          });
        }

        fastify.log.info(
          `Cleanup completed: ${succeededIds.length}/${tempFiles.length} temp files removed`
        );
      }

      // Cleanup of orphan files in .tmp directories (failed/interrupted uploads)
      // Removes files older than 2 hours that weren't promoted to their final path
      try {
        const basePath =
          (await getConfig(prisma, 'storage.local.basePath', false)) ||
          join(require('os').homedir(), '.luke', 'storage');
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        const buckets = await readdir(basePath).catch(() => []);

        for (const bucket of buckets) {
          const tmpDir = join(basePath, bucket, '.tmp');
          const entries = await readdir(tmpDir).catch(() => []);

          for (const entry of entries) {
            const filePath = join(tmpDir, entry);
            try {
              const stats = await stat(filePath);
              if (stats.isFile() && stats.mtimeMs < twoHoursAgo) {
                await unlink(filePath);
                fastify.log.debug({ filePath }, 'Removed orphan .tmp file');
              }
            } catch {
              // File already removed or inaccessible — ignore
            }
          }
        }
      } catch (err) {
        fastify.log.warn({ err }, 'Orphan .tmp cleanup failed');
      }
    } catch (err) {
      fastify.log.error({ err }, 'Temp file cleanup job failed');
    }
  };

  // Run cleanup immediately, then every 30 minutes
  setImmediate(cleanupTempFiles);
  const cleanupTimer = setInterval(cleanupTempFiles, cleanupInterval);

  fastify.addHook('onClose', async () => {
    clearInterval(cleanupTimer);
  });

  fastify.log.info('Temp file cleanup job started (every 30 minutes)');
}

/**
 * Wires up graceful shutdown for SIGTERM, SIGINT, uncaughtException, and unhandledRejection.
 *
 * On any termination signal: stops in-memory stores, closes the HTTP server (5 s timeout),
 * disconnects Prisma, then exits. Fatal errors follow the same path with `process.exit(1)`.
 */
function setupGracefulShutdown() {
  const closeWithTimeout = async (ms: number) => {
    const timeout = new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error('close timeout')), ms)
    );
    await Promise.race([
      (async () => {
        await fastify.close();
        await prisma.$disconnect();
      })(),
      timeout,
    ]);
  };

  const gracefulShutdown = async (signal: string) => {
    fastify.log.info(`Ricevuto segnale ${signal}, avvio shutdown graceful...`);

    try {
      // Stop in-memory cleanup intervals before closing HTTP server
      rateLimitStore.stop();
      idempotencyStore.stop();

      // Close HTTP server
      await closeWithTimeout(5_000);
      fastify.log.info('Server HTTP chiuso');

      fastify.log.info('Shutdown completato');
      process.exit(0);
    } catch (error: unknown) {
      fastify.log.error({ err: error }, 'Errore durante shutdown');
      process.exit(1);
    }
  };

  // Handle termination signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught errors
  const onFatal = async (reason: any, type: string) => { // process events can propagate any thrown value, not just Error
    try {
      fastify.log.fatal({ reason }, `${type}: shutting down`);
      await closeWithTimeout(5_000);
    } catch (e) {
      fastify.log.error({ e }, 'Errore durante close su fatal');
    } finally {
      process.exit(1);
    }
  };

  process.on('uncaughtException', (error: any) => { // Node.js listener signature accepts any thrown value
    void onFatal(error, 'uncaughtException');
  });

  process.on('unhandledRejection', (reason: any) => { // rejection reason can be any value
    void onFatal(reason, 'unhandledRejection');
  });
}

/**
 * POLICY: Bootstrap env guard (API server)
 *
 * Only infrastructure variables are allowed in process.env.
 * Any application configuration (credentials, secrets, external endpoints)
 * must live in AppConfig (database). If a forbidden variable is detected:
 *   - in production: the server exits with exit(1)
 *   - in development: an explicit warning is emitted
 *
 * Allowed variables (API):
 *   DATABASE_URL              — Prisma, needed before DB boot
 *   PORT, HOST                — server bind
 *   NODE_ENV, npm_package_version — standard runtime
 *   LUKE_CORS_ALLOWED_ORIGINS — deploy CORS override (not a secret)
 *   OTEL_*, LOG_LEVEL         — observability infra
 *
 * Web container exceptions (not touched by this guard):
 *   NEXTAUTH_SECRET, NEXTAUTH_URL — NextAuth framework constraint
 *   INTERNAL_API_URL              — Next.js rewrites, resolved at build time
 *   NEXT_PUBLIC_*                 — baked into the client bundle, impossible from DB
 *   COOKIE_SECURE                 — HTTP vs HTTPS deploy setting
 */
const FORBIDDEN_ENV_PATTERNS: RegExp[] = [
  /^SMTP_/i,
  /^LDAP_/i,
  /^JWT_/i,
  /^NEXTAUTH_/i,
  /.*_SECRET$/i,
  /.*_PASSWORD$/i,
  /.*_API_KEY$/i,
  /.*_TOKEN$/i,
];

const ALLOWED_ENV_EXCEPTIONS = new Set<string>([]);

/**
 * Enforces the env-var policy: exits with code 1 in production (warns in development)
 * if any forbidden pattern (SMTP_*, LDAP_*, JWT_*, *_SECRET, *_PASSWORD, etc.) is found
 * in `process.env`. See the policy comment block above for the full allowed-list.
 */
function assertEnvPolicy(): void {
  const violations = Object.keys(process.env).filter(key =>
    !ALLOWED_ENV_EXCEPTIONS.has(key) &&
    FORBIDDEN_ENV_PATTERNS.some(p => p.test(key))
  );

  if (violations.length === 0) return;

  const msg = `[env-policy] Variabili applicative trovate in process.env — devono stare in AppConfig: ${violations.join(', ')}`;

  const bootLogger = pino({ level: 'warn' });
  if (isProduction()) {
    bootLogger.error(msg);
    process.exit(1);
  } else {
    bootLogger.warn(msg);
  }
}

/**
 * Starts the Luke API server.
 *
 * Runs the full startup sequence: env-policy guard, DB connection, config validation,
 * master key check, plugin registration, scheduler setup, and HTTP listen.
 * Exits with code 1 on any startup failure.
 */
const start = async () => {
  try {
    // Verify env var policy BEFORE everything else
    assertEnvPolicy();

    // Test database connection
    await prisma.$connect();
    fastify.log.info('Connessione database stabilita');

    // Validate critical keys in AppConfig
    await validateCriticalConfig(prisma);

    // Test master key availability
    if (!validateMasterKey()) {
      fastify.log.error('Master key non disponibile o invalida');
      process.exit(1);
    }

    // Test secret derivation
    try {
      deriveSecret('api.jwt');
      fastify.log.info('Segreti JWT derivati con successo');
    } catch {
      fastify.log.error('Impossibile derivare segreti JWT');
      process.exit(1);
    }

    // Register plugins and routes in the correct order
    const corsAllowedOrigins = await registerSecurityPlugins(); // CORS must be registered before tRPC
    await registerTRPCPlugin();
    await registerMultipart(); // Global multipart (required by all upload routes)
    await registerStoragePlugin(); // Storage upload/download routes
    await registerBackupDownloadRoute(fastify, prisma); // Backup blob download (admin-only, streamed)
    await registerBackupExportDownloadRoute(fastify, prisma); // Passphrase-protected portable export download (streamed)
    await registerAuditLogExportDownloadRoute(fastify, prisma); // Audit log CSV export (admin-only, streamed)
    await registerBackupImportRoute(fastify, prisma); // Passphrase-protected portable export upload
    await registerBrandLogoRoutes(); // Brand logo upload routes
    await registerCompanyLogoRoutes(); // Company logo upload routes
    await registerCollectionRowPictureRoutes(); // Collection row picture upload routes
    await registerSpecsheetImageRoutes(); // Specsheet image upload routes
    await registerSeasonCalendarExportRoutes(); // iCal + CSV export
    await registerSseRoute(fastify, corsAllowedOrigins); // SSE real-time push
    await registerHealthRoute();

    // Configure temp file cleanup
    setupTempFileCleanup();

    // Register NAV sync scheduler (onReady + onClose)
    registerNavSyncScheduler(fastify, prisma);

    // Register NAV portfolio sync scheduler → PG (onReady + onClose)
    registerPortafoglioSyncScheduler(fastify, prisma);

    // Register KIMO-FASHION table sync scheduler NAV → PG (onReady + onClose)
    registerKimoSyncScheduler(fastify, prisma);

    // Register milestone deadline notification scheduler (tick every hour)
    registerMilestoneDeadlineScheduler(fastify, prisma);

    // Register calendar email digest scheduler (daily run at 07:00)
    registerCalendarDigestScheduler(fastify, prisma);

    // Register automatic backup scheduler + retention pruning (tick every hour)
    registerBackupScheduler(fastify, prisma);

    // Register maintenance mode scheduler: warning ladder + automatic activation (tick every 60s)
    registerMaintenanceModeScheduler(fastify, prisma);

    // Register periodic flush of the calendar notification aggregation buffer (tick every 30s)
    registerCalendarNotificationBuffer(fastify, prisma);

    // Register retention sweep for audit log + notifications + dedup keys (tick every 24h)
    registerRetentionScheduler(fastify, prisma);

    // Register asset derivative reconciliation (thumb/card/export image variants, tick every 5min)
    registerDerivativeScheduler(fastify, prisma);

    // Register feedback GitHub issue sync scheduler (tick interval from AppConfig, default 24h)
    registerFeedbackSyncScheduler(fastify, prisma);

    // Configure graceful shutdown
    setupGracefulShutdown();

    // Start server
    const port = parseInt(process.env.PORT || '3001', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });

    fastify.log.info(`Luke API server listening on http://${host}:${port}`);
    fastify.log.info(`Liveness probe: http://${host}:${port}/livez`);
    fastify.log.info(`Readiness probe: http://${host}:${port}/readyz`);
    fastify.log.info(`tRPC endpoint: http://${host}:${port}/trpc`);

    if (isDevelopment()) {
      fastify.log.info(`Prisma Studio: pnpm --filter @luke/api prisma:studio`);
    }
  } catch (err: unknown) {
    fastify.log.error({ err }, 'Errore avvio server');
    process.exit(1);
  }
};

// Start the server
start();
