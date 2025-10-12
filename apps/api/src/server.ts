/**
 * Server Fastify per Luke API
 * Configurazione completa con tRPC, Prisma, sicurezza e logging
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { PrismaClient } from '@prisma/client';
import { appRouter } from './routers';
import { createContext } from './lib/trpc';

/**
 * Configurazione del logger Pino
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
};

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
  // Helmet per security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  });

  // CORS per cross-origin requests
  await fastify.register(cors, {
    origin:
      process.env.NODE_ENV === 'development'
        ? ['http://localhost:3000', 'http://localhost:3001']
        : false, // In production, configurare origins specifici
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-luke-trace-id'],
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
      createContext: ({ req, res }: any) => createContext({ prisma }),
      onError: ({ path, error }: any) => {
        fastify.log.error(`tRPC Error on '${path}': ${error.message}`);
      },
    },
  });
}

/**
 * Registra route di health check
 */
async function registerHealthRoute() {
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
    // Registra plugin e route
    await registerSecurityPlugins();
    await registerTRPCPlugin();
    await registerHealthRoute();

    // Configura graceful shutdown
    setupGracefulShutdown();

    // Test connessione database
    await prisma.$connect();
    fastify.log.info('Connessione database stabilita');

    // Avvia server
    const port = parseInt(process.env.PORT || '3001', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });

    fastify.log.info(`🚀 Luke API server listening on http://${host}:${port}`);
    fastify.log.info(`📊 Health check: http://${host}:${port}/api/health`);
    fastify.log.info(`🔗 tRPC endpoint: http://${host}:${port}/trpc`);

    if (process.env.NODE_ENV === 'development') {
      fastify.log.info(
        `🗄️  Prisma Studio: pnpm --filter @luke/api prisma:studio`
      );
    }
  } catch (err: any) {
    fastify.log.error('Errore avvio server:', err);
    console.error('Errore dettagliato:', err);
    process.exit(1);
  }
};

// Avvia il server
start();
