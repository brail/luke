/**
 * Router tRPC per gestione utenti
 * Compone i sub-router per CRUD core e procedure amministrative
 */

import { t } from '../lib/t';

import { usersAdminRouter } from './users.admin.router';
import { usersCoreRouter } from './users.core.router';

/**
 * Router per gestione utenti
 * Merge flat di:
 * - usersCoreRouter: list, getById, create, update, softDelete, hardDelete
 * - usersAdminRouter: revokeUserSessions, forceVerifyEmail, changeEmail
 */
export const usersRouter = t.mergeRouters(usersCoreRouter, usersAdminRouter);
