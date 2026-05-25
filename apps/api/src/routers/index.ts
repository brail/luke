/**
 * Router principale tRPC
 * Combina tutti i router dell'applicazione
 */

import { router } from '../lib/trpc';

import { authRouter } from './auth';
import { companyRouter } from './company';
import { brandRouter } from './brand';
import { catalogRouter } from './catalog';
import { collectionLayoutRouter } from './collectionLayout';
import { calendarCatalogRouter } from './calendarCatalog';
import { collectionCatalogRouter } from './collectionCatalog';
import { collectionLayoutRevisionRouter } from './collectionLayoutRevision';
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
import { feedbackRouter } from './feedback';
import { notificationsRouter } from './notifications';

/**
 * Router principale dell'applicazione
 * Combina tutti i router disponibili
 */
export const appRouter = router({
  auth: authRouter,
  brand: brandRouter,
  company: companyRouter,
  catalog: catalogRouter,
  collectionLayout: collectionLayoutRouter,
  calendarCatalog: calendarCatalogRouter,
  collectionCatalog: collectionCatalogRouter,
  collectionLayoutRevision: collectionLayoutRevisionRouter,
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
  feedback: feedbackRouter,
  notifications: notificationsRouter,
});

/**
 * Tipo del router principale per type-safety
 * Esportato per essere utilizzato dal client tRPC
 */
export type AppRouter = typeof appRouter;
