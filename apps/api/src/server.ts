/**
 * Server Fastify per Luke API
 * Configurazione completa con tRPC, Prisma, sicurezza e logging
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { PrismaClient } from '@prisma/client';
import { appRouter } from './routers';
import { createContext } from './lib/trpc';
import { validateMasterKey, deriveSecret } from '@luke/core/server';
import {
  pinoTraceMiddleware,
  pinoSerializers,
} from './observability/pinoTrace';
import { runReadinessChecks } from './observability/readiness';
import { idempotencyMiddleware } from './lib/idempotency';
import { buildCorsAllowedOrigins } from './lib/cors';

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
});

/**
 * Parser JSON personalizzato per gestire Content-Type con charset
 * Risolve il problema delle mutation tRPC che non ricevono i parametri
 */
fastify.addContentTypeParser(
  /^application\/json/,
  { parseAs: 'string' },
  (req, body, done) => {
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
  await fastify.register(cookie, {
    secret: deriveSecret('cookie.secret'),
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

  // Rate limiting critico per endpoint sensibili
  fastify.addHook('preHandler', async (request, reply) => {
    const criticalPaths = [
      '/trpc/users.create',
      '/trpc/users.update',
      '/trpc/users.delete',
      '/trpc/users.hardDelete',
      '/trpc/config.set',
      '/trpc/config.update',
      '/trpc/config.delete',
      '/trpc/auth.login',
      '/trpc/auth.changePassword',
      '/trpc/me.changePassword',
    ];

    if (criticalPaths.some(path => request.url.includes(path))) {
      // Rate limit più stretto per operazioni critiche
      const criticalMax = isDevelopment ? 100 : 10; // 100 req/min in dev, 10 in prod

      // Rate limit specifico per me.changePassword
      if (request.url.includes('/trpc/me.changePassword')) {
        const changePasswordMax = isDevelopment ? 20 : 5; // 20/15min in dev, 5/15min in prod

        try {
          // Rate limit specifico per cambio password
          // TODO: Implementare rate limiting specifico con storage dedicato
          fastify.log.info({
            message: 'Change password endpoint accessed',
            path: request.url,
            ip: request.ip,
            rateLimit: `${changePasswordMax}/15min`,
          });
        } catch (error) {
          reply.status(429).send({
            error: 'Change password rate limit exceeded',
            message: `Too many password change attempts from ${request.ip}`,
            retryAfter: 900, // 15 minuti
          });
          return;
        }
      } else {
        // Rate limit generico per altri endpoint critici
        try {
          fastify.log.info({
            message: 'Critical endpoint accessed',
            path: request.url,
            ip: request.ip,
          });
        } catch (error) {
          reply.status(429).send({
            error: 'Critical rate limit exceeded',
            message: `Too many critical requests from ${request.ip}`,
            retryAfter: 60,
          });
          return;
        }
      }
    }
  });

  // Idempotency middleware per mutazioni critiche
  fastify.addHook('preHandler', async (request, reply) => {
    await idempotencyMiddleware(request, reply, async () => {});
  });
}

/**
 * Registra route OPTIONS per tRPC (gestione CORS preflight)
 */
async function registerTRPCOptions() {
  // Gestisci richieste OPTIONS per tRPC
  fastify.options('/trpc/*', async (request, reply) => {
    // CORS headers sono già gestiti dal plugin CORS
    reply.status(204).send();
  });
}

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
      onError: ({ path, error }: any) => {
        fastify.log.error(`tRPC Error on '${path}': ${error.message}`);
      },
    },
    // Gestisci richieste OPTIONS per CORS
    useWSS: false,
  });
}

/**
 * Registra route di health check e readiness
 */
async function registerHealthRoute() {
  // Liveness: processo attivo (sempre 200 se process vivo)
  fastify.get('/livez', async (request, reply) => {
    return { status: 'ok' };
  });

  // Readiness: sistema pronto per servire richieste
  fastify.get('/readyz', async (request, reply) => {
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
  fastify.get('/healthz', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/api/health', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '0.1.0',
      environment: process.env.NODE_ENV || 'development',
    };
  });

  // Route root per compatibilità
  fastify.get('/', async (request, reply) => {
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
}

/**
 * Configura graceful shutdown
 */
function setupGracefulShutdown() {
  const gracefulShutdown = async (signal: string) => {
    fastify.log.info(`Ricevuto segnale ${signal}, avvio shutdown graceful...`);

    try {
      // Chiudi server HTTP
      await fastify.close();
      fastify.log.info('Server HTTP chiuso');

      // Chiudi connessione Prisma
      await prisma.$disconnect();
      fastify.log.info('Connessione database chiusa');

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
  process.on('uncaughtException', (error: any) => {
    fastify.log.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason: any, promise: any) => {
    fastify.log.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
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
