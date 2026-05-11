/**
 * Router principale tRPC
 * Combina tutti i router dell'applicazione
 */

import { router } from '../lib/trpc';

import { authRouter } from './auth';
import { brandRouter } from './brand';
import { catalogRouter } from './catalog';
import { collectionLayoutRouter } from './collectionLayout';
import { collectionCatalogRouter } from './collectionCatalog';
import { merchandisingPlanRouter } from './merchandisingPlan';
import { configRouter } from './config';
import { contextRouter } from './context';
import { healthRouter } from './health';
import { integrationsRouter } from './integrations';
import { maintenanceRouter } from './maintenance';
import { meRouter } from './me';
import { pricingRouter } from './pricing';
import { publicRouter } from './public';
import { seasonRouter } from './season';
import { sectionAccessRouter } from './sectionAccess';
import { storageRouter } from './storage';
import { usersRouter } from './users';
import { vendorsRouter } from './vendors';
import { salesRouter } from './sales';
import { seasonCalendarRouter } from './seasonCalendar';
import { dashboardRouter } from './dashboard';

/**
 * Router principale dell'applicazione
 * Combina tutti i router disponibili
 */
export const appRouter = router({
  auth: authRouter,
  brand: brandRouter,
  catalog: catalogRouter,
  collectionLayout: collectionLayoutRouter,
  collectionCatalog: collectionCatalogRouter,
  merchandisingPlan: merchandisingPlanRouter,
  config: configRouter,
  context: contextRouter,
  health: healthRouter,
  integrations: integrationsRouter,
  maintenance: maintenanceRouter,
  public: publicRouter,
  me: meRouter,
  pricing: pricingRouter,
  season: seasonRouter,
  sectionAccess: sectionAccessRouter,
  storage: storageRouter,
  users: usersRouter,
  vendors: vendorsRouter,
  sales: salesRouter,
  seasonCalendar: seasonCalendarRouter,
  dashboard: dashboardRouter,
});

/**
 * Tipo del router principale per type-safety
 * Esportato per essere utilizzato dal client tRPC
 */
export type AppRouter = typeof appRouter;
