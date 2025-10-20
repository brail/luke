/**
 * Router principale tRPC
 * Combina tutti i router dell'applicazione
 */

import { router } from '../lib/trpc';

import { authRouter } from './auth';
import { configRouter } from './config';
import { integrationsRouter } from './integrations';
import { meRouter } from './me';
import { publicRouter } from './public';
import { storageRouter } from './storage';
import { usersRouter } from './users';

/**
 * Router principale dell'applicazione
 * Combina tutti i router disponibili
 */
export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  config: configRouter,
  integrations: integrationsRouter,
  public: publicRouter,
  me: meRouter,
  storage: storageRouter,
});

/**
 * Tipo del router principale per type-safety
 * Esportato per essere utilizzato dal client tRPC
 */
export type AppRouter = typeof appRouter;
