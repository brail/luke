/**
 * tRPC router for user management
 * Composes sub-routers for core CRUD and administrative procedures
 */

import { t } from '../lib/t';

import { usersAdminRouter } from './users.admin.router';
import { usersCoreRouter } from './users.core.router';
import { userPreferencesRouter } from './users.preferences.router';

/**
 * Router for user management
 * Merge of:
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
