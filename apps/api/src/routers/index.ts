/**
 * Router principale tRPC
 * Combina tutti i router dell'applicazione
 */

import { router } from '../lib/trpc';

import { authRouter } from './auth';
import { catalogRouter } from './catalog';
import { configRouter } from './config';
import { contextRouter } from './context';
import { healthRouter } from './health';
import { integrationsRouter } from './integrations';
import { maintenanceRouter } from './maintenance';
import { meRouter } from './me';
import { publicRouter } from './public';
import { rbacRouter } from './rbac';
import { sectionAccessRouter } from './sectionAccess';
import { storageRouter } from './storage';
import { usersRouter } from './users';

/**
 * Router principale dell'applicazione
 * Combina tutti i router disponibili
 */
export const appRouter = router({
  auth: authRouter,
  catalog: catalogRouter,
  config: configRouter,
  context: contextRouter,
  health: healthRouter,
  integrations: integrationsRouter,
  maintenance: maintenanceRouter,
  public: publicRouter,
  me: meRouter,
  rbac: rbacRouter,
  sectionAccess: sectionAccessRouter,
  storage: storageRouter,
  users: usersRouter,
});

/**
 * Tipo del router principale per type-safety
 * Esportato per essere utilizzato dal client tRPC
 */
export type AppRouter = typeof appRouter;
