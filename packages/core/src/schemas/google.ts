/**
 * Google Workspace integration config, in the two mutually exclusive auth modes.
 *
 * Shared by `integrations.google.saveConfig` and the settings page, so the two cannot disagree on
 * what counts as filled in.
 */

import { z } from 'zod';

/** Server-to-server auth: a service account key, optionally impersonating a Workspace user. */
const googleServiceAccountConfigSchema = z.object({
  authMode: z.literal('service_account'),
  serviceEmail: z.string().email('Email service account non valida'),
  /** Write-only: absent means "keep the stored key", never "clear it". */
  serviceKey: z.string().optional(),
  impersonateEmail: z.string().email('Email non valida').or(z.literal('')).optional(),
  domain: z.string().min(1, 'Workspace domain obbligatorio'),
  calendarSyncEnabled: z.boolean(),
});

/** Delegated auth: an OAuth client the user connects their own Google account through. */
const googleOauthConfigSchema = z.object({
  authMode: z.literal('oauth_user'),
  oauthClientId: z.string().min(1, 'Client ID obbligatorio'),
  /** Write-only, same rule as `serviceKey`. */
  oauthClientSecret: z.string().optional(),
  domain: z.string().min(1, 'Workspace domain obbligatorio'),
  calendarSyncEnabled: z.boolean(),
});

/** What `integrations.google.saveConfig` accepts. */
export const googleWorkspaceConfigSchema = z.discriminatedUnion('authMode', [
  googleServiceAccountConfigSchema,
  googleOauthConfigSchema,
]);
export type GoogleWorkspaceConfig = z.infer<typeof googleWorkspaceConfigSchema>;
