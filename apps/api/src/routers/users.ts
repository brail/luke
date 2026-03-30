/**
 * Router tRPC per gestione utenti
 * Compone i sub-router per CRUD core e procedure amministrative
 */

import { t } from '../lib/t';

import { usersAdminRouter } from './users.admin.router';
import { usersCoreRouter } from './users.core.router';
import { userPreferencesRouter } from './users.preferences.router';

/**
 * Router per gestione utenti
 * Merge di:
 * - usersCoreRouter: list, getById, create, update, softDelete, hardDelete
 * - usersAdminRouter: revokeUserSessions, forceVerifyEmail, changeEmail
 * - userPreferencesRouter: preferences (menu collapsible states, etc)
 */
export const usersRouter = t.mergeRouters(
  usersCoreRouter,
  usersAdminRouter,
  t.router({
    preferences: userPreferencesRouter,
  })
);
