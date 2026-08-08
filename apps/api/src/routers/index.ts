/**
 * Main tRPC router
 * Combines all application routers
 */

import { router } from '../lib/trpc';

import { auditLogRouter } from './auditLog';
import { authRouter } from './auth';
import { brandRouter } from './brand';
import { catalogRouter } from './catalog';
import { collectionCatalogRouter } from './collectionCatalog';
import { collectionLayoutRouter } from './collectionLayout';
import { collectionLayoutRevisionRouter } from './collectionLayoutRevision';
import { companyRouter } from './company';
import { configRouter } from './config';
import { contextRouter } from './context';
import { dashboardRouter } from './dashboard';
import { editLockRouter } from './editLock';
import { feedbackRouter } from './feedback';
import { healthRouter } from './health';
import { holidaysRouter } from './holidays';
import { integrationsRouter } from './integrations';
import { maintenanceRouter } from './maintenance';
import { meRouter } from './me';
import { merchandisingPlanRouter } from './merchandisingPlan';
import { notificationsRouter } from './notifications';
import { phaseRouter } from './phase';
import { phaseAlertRouter } from './phaseAlert';
import { phaseHistoryRouter } from './phaseHistory';
import { planningGroupRouter } from './planningGroup';
import { pricingRouter } from './pricing';
import { publicRouter } from './public';
import { salesRouter } from './sales';
import { seasonRouter } from './season';
import { seasonCalendarRouter } from './seasonCalendar';
import { sectionAccessRouter } from './sectionAccess';
import { storageRouter } from './storage';
import { systemRouter } from './system';
import { usersRouter } from './users';
import { vendorsRouter } from './vendors';

/**
 * Main application router
 * Combines all available routers
 */
export const appRouter = router({
  auditLog: auditLogRouter,
  auth: authRouter,
  brand: brandRouter,
  company: companyRouter,
  catalog: catalogRouter,
  collectionLayout: collectionLayoutRouter,
  editLock: editLockRouter,
  collectionCatalog: collectionCatalogRouter,
  phase: phaseRouter,
  phaseHistory: phaseHistoryRouter,
  phaseAlert: phaseAlertRouter,
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
  planningGroup: planningGroupRouter,
  holidays: holidaysRouter,
  dashboard: dashboardRouter,
  feedback: feedbackRouter,
  notifications: notificationsRouter,
  system: systemRouter,
});

/**
 * Type of the main router for type-safety
 * Exported to be used by the tRPC client
 */
export type AppRouter = typeof appRouter;
