/**
 * Server Fastify per Luke API
 * Configurazione completa con tRPC, Prisma, sicurezza e logging
 */

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { PrismaClient } from '@prisma/client';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import Fastify from 'fastify';

import {
  validateMasterKey,
  deriveSecret,
  HKDF_INFO_COOKIE,
} from '@luke/core/server';

import { buildCorsAllowedOrigins } from './lib/cors';
import { createContext } from './lib/trpc';
import { setGlobalErrorHandler } from './lib/error';
import { getConfig } from './lib/configManager';
import {
  pinoTraceMiddleware,
  // pinoSerializers,
} from './observability/pinoTrace';
import { runReadinessChecks } from './observability/readiness';
import { storagePlugin } from './plugins/storage-upload';
import brandLogoRoutes from './routes/brandLogo.routes';
import { appRouter } from './routers';

/**
 * Configurazione del logger Pino con serializers per sicurezza
 */
const loggerConfig = {
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  transport:
    process.env.NODE_ENV === 'development'
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

/**
 * Inizializza Fastify con configurazione logger
 */
const fastify = Fastify({
  logger: loggerConfig,
  requestTimeout: 20_000,
  connectionTimeout: 10_000,
});

// Registra handler/onError globali per logging e risposta sicura
setGlobalErrorHandler(fastify);

/**
 * Parser JSON personalizzato per gestire Content-Type con charset
 * Risolve il problema delle mutation tRPC che non ricevono i parametri
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

/**
 * Inizializza Prisma Client
 */
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
});

/**
 * Registra plugin di sicurezza
 */
async function registerSecurityPlugins() {
  // Cookie plugin per gestione sessioni
  // Secret derivato via HKDF-SHA256 dalla master key (dominio: cookie.secret)
  await fastify.register(cookie, {
    secret: deriveSecret(HKDF_INFO_COOKIE),
  });

  // Rate limiting globale (permissivo)
  const isDevelopment = process.env.NODE_ENV === 'development';
  await fastify.register(rateLimit, {
    max: isDevelopment ? 1000 : 100, // 1000 req/min in dev, 100 in prod
    timeWindow: '1 minute',
    cache: 10000,
    skipOnError: true,
    errorResponseBuilder: (request: any, context: any) => ({
      error: 'Rate limit exceeded',
      message: `Too many requests from ${request.ip}`,
      retryAfter: Math.round(context.ttl / 1000),
    }),
  });

  // Helmet per security headers con CSP minimale per API JSON-only
  await fastify.register(helmet, {
    contentSecurityPolicy: isDevelopment
      ? false // Disabilita CSP in dev per evitare problemi
      : {
          directives: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'none'"],
          },
        },
    hsts: isDevelopment
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
  const corsConfig = buildCorsAllowedOrigins(
    (process.env.NODE_ENV as 'development' | 'production' | 'test') ||
      'development'
  );

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
  if (corsConfig.origins.length > 0 || isDevelopment) {
    await fastify.register(cors, {
      origin: isDevelopment ? true : corsConfig.origins,
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

/**
 * Registra tRPC plugin
 */
async function registerTRPCPlugin() {
  await fastify.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: async ({ req, res }: any) =>
        createContext({ prisma, req, res }),
      onError: ({ path, error, ctx }: any) => {
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
 * Registra storage plugin per upload/download
 */
async function registerStoragePlugin() {
  await fastify.register(storagePlugin, { prisma });
}

/**
 * Registra brand logo routes
 */
async function registerBrandLogoRoutes() {
  await fastify.register(brandLogoRoutes, { prisma });
}

/**
 * Registra static file server per uploads
 */
async function registerStaticFiles() {
  const basePath =
    (await getConfig(prisma, 'storage.local.basePath', false)) ||
    '/tmp/luke-storage';

  await fastify.register(fastifyStatic, {
    root: basePath,
    prefix: '/uploads/',
    decorateReply: false,
  });
}

/**
 * Registra route di health check e readiness
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
      environment: process.env.NODE_ENV || 'development',
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
 * Configura graceful shutdown
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
  const onFatal = async (reason: any, type: string) => {
    try {
      fastify.log.fatal({ reason }, `${type}: shutting down`);
      await closeWithTimeout(5_000);
    } catch (e) {
      fastify.log.error({ e }, 'Errore durante close su fatal');
    } finally {
      process.exit(1);
    }
  };

  process.on('uncaughtException', (error: any) => {
    void onFatal(error, 'uncaughtException');
  });

  process.on('unhandledRejection', (reason: any) => {
    void onFatal(reason, 'unhandledRejection');
  });
}

/**
 * Avvia il server
 */
const start = async () => {
  try {
    // Test connessione database
    await prisma.$connect();
    fastify.log.info('Connessione database stabilita');

    // Test master key availability
    if (!validateMasterKey()) {
      fastify.log.error('Master key non disponibile o invalida');
      process.exit(1);
    }

    // Test secret derivation
    try {
      deriveSecret('api.jwt');
      fastify.log.info('Segreti JWT derivati con successo');
    } catch (error: any) {
      fastify.log.error('Impossibile derivare segreti JWT');
      process.exit(1);
    }

    // Registra plugin e route nell'ordine corretto
    await registerSecurityPlugins(); // CORS deve essere registrato prima di tRPC
    await registerTRPCPlugin();
    await registerStoragePlugin(); // Storage upload/download routes
    await registerBrandLogoRoutes(); // Brand logo upload routes
    await registerStaticFiles(); // Static file server per uploads
    await registerHealthRoute();

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

    if (process.env.NODE_ENV === 'development') {
      fastify.log.info(`Prisma Studio: pnpm --filter @luke/api prisma:studio`);
    }
  } catch (err: any) {
    fastify.log.error('Errore avvio server:', err);
    fastify.log.error('Errore dettagliato:', err);
    process.exit(1);
  }
};

// Avvia il server
start();
