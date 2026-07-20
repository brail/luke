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

import { registerCalendarDigestScheduler } from './lib/calendarDigestScheduler';
import { registerCalendarNotificationBuffer } from './lib/calendarNotificationBuffer';
import { getConfig, validateCriticalConfig } from './lib/configManager';
import { buildCorsAllowedOrigins } from './lib/cors';
import { setGlobalErrorHandler } from './lib/error';
import { idempotencyStore } from './lib/idempotency';
import { registerKimoSyncScheduler } from './lib/kimoSyncScheduler';
import { registerMilestoneDeadlineScheduler } from './lib/milestoneDeadlineScheduler';
import { registerNavSyncScheduler } from './lib/navSyncScheduler';
import { registerPortafoglioSyncScheduler } from './lib/portafoglioSyncScheduler';
import { rateLimitStore } from './lib/ratelimit';
import { createContext } from './lib/trpc';
import {
  pinoTraceMiddleware,
  // pinoSerializers,
} from './observability/pinoTrace';
import { runReadinessChecks } from './observability/readiness';
import { storagePlugin } from './plugins/storage-upload';
import { appRouter } from './routers';
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
} as any;

/** Fastify instance shared across all route registrations in this module. */
const fastify = Fastify({
  logger: loggerConfig,
  requestTimeout: 360_000, // 6 min — allineato a proxyTimeout Next.js e pool NAV (300 s + margine)
  connectionTimeout: 0,    // disabilitato — requestTimeout gestisce il limite totale
  routerOptions: { maxParamLength: 5000 }, // tRPC batch requests contain multiple procedure names in the URL param
});

// Registra handler/onError globali per logging e risposta sicura
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
  // Cookie plugin per gestione sessioni
  // Secret derivato via HKDF-SHA256 dalla master key (dominio: cookie.secret)
  await fastify.register(cookie, {
    secret: deriveSecret(HKDF_INFO_COOKIE),
  });

  // Rate limiting globale (permissivo)
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

  // Helmet per security headers con CSP minimale per API JSON-only
  await fastify.register(helmet, {
    contentSecurityPolicy: isDevelopment()
      ? false // Disabilita CSP in dev per evitare problemi
      : {
          directives: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'none'"],
          },
        },
    hsts: isDevelopment()
      ? false // Disabilita HSTS in dev
      : {
          maxAge: 15552000, // 180 giorni
          includeSubDomains: true,
          preload: false, // Non forzare preload
        },
    // Header aggiuntivi per sicurezza
    noSniff: true, // X-Content-Type-Options: nosniff
    referrerPolicy: { policy: 'no-referrer' }, // Referrer-Policy: no-referrer
    frameguard: { action: 'deny' }, // X-Frame-Options: DENY
    dnsPrefetchControl: false, // X-DNS-Prefetch-Control: off
  });

  // CORS ibrido con priorità AppConfig → ENV → default
  const envName = isDevelopment() ? 'development' : isProduction() ? 'production' : 'test';
  const corsConfig = buildCorsAllowedOrigins(envName);

  // Log informativo CORS (non stampare lista completa in prod)
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

  // Registra CORS solo se ci sono origini configurate o siamo in dev
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

  // Middleware per correlazione trace ID con log Pino
  fastify.addHook('onRequest', pinoTraceMiddleware);

  // Rate limiting ora gestito via tRPC middleware per-rotta

  // Idempotency è gestito a livello tRPC middleware per procedure specifiche

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
        fastify.log.error(
          {
            path,
            err: { message: error.message, code: (error as any).code },
            traceId,
          },
          'tRPC error'
        );
      },
    },
    // Gestisci richieste OPTIONS per CORS
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
  // Liveness: processo attivo (sempre 200 se process vivo)
  fastify.get('/livez', async (_request, _reply) => {
    return { status: 'ok' };
  });

  // Readiness: sistema pronto per servire richieste
  fastify.get('/readyz', async (_request, reply) => {
    const result = await runReadinessChecks(prisma);

    if (!result.allOk) {
      reply.status(503);
      // Log interno senza esporre in risposta HTTP
      fastify.log.warn({ checks: result.checks }, 'Readiness check failed');
    }

    return {
      status: result.allOk ? 'ready' : 'unready',
      timestamp: result.timestamp,
      checks: result.checks, // OK esporre status per debug K8s
    };
  });

  // Route legacy per retrocompatibilità
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

  // Route root per compatibilità
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
  const cleanupInterval = 30 * 60 * 1000; // 30 minuti

  const cleanupTempFiles = async () => {
    try {
      const provider = await getStorageProvider(prisma);

      // Trova file temporanei più vecchi di 1 ora
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const tempFiles = await prisma.fileObject.findMany({
        where: {
          confirmedAt: null,
          bucket: { in: ['brand-logos', 'company-assets', 'collection-row-pictures', 'merchandising-specsheet-images'] },
          createdAt: { lt: oneHourAgo },
        },
      });

      if (tempFiles.length > 0) {
        fastify.log.info(
          `Cleaning up ${tempFiles.length} temp files older than 1 hour`
        );

        // Delete physical files first (best-effort), collect succeeded IDs
        const succeededIds: string[] = [];
        for (const file of tempFiles) {
          try {
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

        // Batch delete DB records only for files successfully removed from storage
        if (succeededIds.length > 0) {
          await prisma.fileObject.deleteMany({
            where: { id: { in: succeededIds } },
          });
        }

        fastify.log.info(
          `Cleanup completed: ${succeededIds.length}/${tempFiles.length} temp files removed`
        );
      }

      // Pulizia file orfani nelle directory .tmp (upload falliti/interrotti)
      // Rimuove file più vecchi di 2 ore che non sono stati promossi al path finale
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
              // File già rimosso o non accessibile — ignora
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

  // Avvia cleanup immediato e poi ogni 30 minuti
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

      // Chiudi server HTTP
      await closeWithTimeout(5_000);
      fastify.log.info('Server HTTP chiuso');

      fastify.log.info('Shutdown completato');
      process.exit(0);
    } catch (error: any) {
      fastify.log.error('Errore durante shutdown:', error);
      process.exit(1);
    }
  };

  // Gestisci segnali di terminazione
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Gestisci errori non catturati
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
 * Solo variabili di infrastruttura sono ammesse in process.env.
 * Qualsiasi configurazione applicativa (credenziali, segreti, endpoint esterni)
 * deve vivere in AppConfig (database). Se viene rilevata una variabile vietata:
 *   - in produzione: il server termina con exit(1)
 *   - in sviluppo: viene emesso un warning esplicito
 *
 * Variabili ammesse (API):
 *   DATABASE_URL              — Prisma, necessario prima del boot DB
 *   PORT, HOST                — bind server
 *   NODE_ENV, npm_package_version — runtime standard
 *   LUKE_CORS_ALLOWED_ORIGINS — override CORS di deploy (non segreto)
 *   OTEL_*, LOG_LEVEL         — observability infra
 *
 * Eccezioni web container (non toccate da questo guard):
 *   NEXTAUTH_SECRET, NEXTAUTH_URL — vincolo framework NextAuth
 *   INTERNAL_API_URL              — Next.js rewrites, risolto a build-time
 *   NEXT_PUBLIC_*                 — baked nel bundle client, impossibile da DB
 *   COOKIE_SECURE                 — setting deploy HTTP vs HTTPS
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
    // Verifica policy env var PRIMA di tutto il resto
    assertEnvPolicy();

    // Test connessione database
    await prisma.$connect();
    fastify.log.info('Connessione database stabilita');

    // Valida chiavi critiche in AppConfig
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

    // Registra plugin e route nell'ordine corretto
    const corsAllowedOrigins = await registerSecurityPlugins(); // CORS deve essere registrato prima di tRPC
    await registerTRPCPlugin();
    await registerMultipart(); // Multipart globale (richiesto da tutti i route di upload)
    await registerStoragePlugin(); // Storage upload/download routes
    await registerBrandLogoRoutes(); // Brand logo upload routes
    await registerCompanyLogoRoutes(); // Company logo upload routes
    await registerCollectionRowPictureRoutes(); // Collection row picture upload routes
    await registerSpecsheetImageRoutes(); // Specsheet image upload routes
    await registerSeasonCalendarExportRoutes(); // iCal + CSV export
    await registerSseRoute(fastify, corsAllowedOrigins); // SSE real-time push
    await registerHealthRoute();

    // Configura cleanup file temporanei
    setupTempFileCleanup();

    // Registra scheduler sync NAV (onReady + onClose)
    registerNavSyncScheduler(fastify, prisma);

    // Registra scheduler sync portafoglio NAV → PG (onReady + onClose)
    registerPortafoglioSyncScheduler(fastify, prisma);

    // Registra scheduler sync tabelle KIMO-FASHION NAV → PG (onReady + onClose)
    registerKimoSyncScheduler(fastify, prisma);

    // Registra scheduler notifiche deadline milestone (tick ogni ora)
    registerMilestoneDeadlineScheduler(fastify, prisma);

    // Registra scheduler digest email calendario (esecuzione giornaliera alle 07:00)
    registerCalendarDigestScheduler(fastify, prisma);

    // Registra flush periodico del buffer di aggregazione notifiche calendario (tick ogni 30s)
    registerCalendarNotificationBuffer(fastify, prisma);

    // Configura graceful shutdown
    setupGracefulShutdown();

    // Avvia server
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
  } catch (err: any) {
    fastify.log.error({ err }, 'Errore avvio server');
    process.exit(1);
  }
};

// Avvia il server
start();
