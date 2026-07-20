import { getClient, getWorkspaceDomain } from './client.js';

import type { calendar_v3 } from 'googleapis';

/**
 * Grants read access to a Google Calendar for the given user email.
 */
export async function addCalendarReader(
  googleCalendarId: string,
  email: string
): Promise<void> {
  const client = getClient();
  await client.acl.insert({
    calendarId: googleCalendarId,
    requestBody: {
      role: 'reader',
      scope: { type: 'user', value: email },
    },
  });
}

/**
 * Revokes read access to a Google Calendar for the given user email.
 * Idempotent: silently succeeds if the ACL rule does not exist (404).
 */
export async function removeCalendarReader(
  googleCalendarId: string,
  email: string
): Promise<void> {
  const client = getClient();
  const ruleId = `user:${email}`;
  try {
    await client.acl.delete({ calendarId: googleCalendarId, ruleId });
  } catch (err: unknown) {
    // 404 = rule already gone — idempotent
    if ((err as { code?: number }).code !== 404) throw err;
  }
}

/**
 * Returns the email addresses of all users with reader access to a Google Calendar.
 */
export async function listCalendarReaders(
  googleCalendarId: string
): Promise<string[]> {
  const client = getClient();
  const res = await client.acl.list({ calendarId: googleCalendarId });
  const rules = res.data.items ?? [];
  return rules
    .filter(r => r.role === 'reader' && r.scope?.type === 'user' && r.scope.value)
    .map(r => r.scope!.value!);
}

/**
 * Reconciles the reader ACL of a Google Calendar to exactly match `expectedEmails`.
 * Adds missing readers and removes unexpected ones in parallel.
 *
 * @param expectedEmails - Complete desired set of reader email addresses
 */
export async function syncCalendarReaders(
  googleCalendarId: string,
  expectedEmails: string[]
): Promise<void> {
  const current = await listCalendarReaders(googleCalendarId);
  const expectedSet = new Set(expectedEmails);
  const currentSet = new Set(current);

  const toAdd = expectedEmails.filter(e => !currentSet.has(e));
  const toRemove = current.filter(e => !expectedSet.has(e));

  await Promise.all([
    ...toAdd.map(e => addCalendarReader(googleCalendarId, e)),
    ...toRemove.map(e => removeCalendarReader(googleCalendarId, e)),
  ]);
}

/**
 * Downgrades the calendar's domain-wide default ACL rule to `freeBusyReader` if more permissive.
 *
 * Google auto-creates a `domain:<workspaceDomain>` ACL rule on every calendar created inside a
 * Workspace, inherited from the org's default calendar sharing setting (Admin Console). That
 * setting can grant domain members edit access, which would silently override the per-user
 * `reader` grants this module sets explicitly — Google Calendar applies the most permissive rule
 * that matches a given user. Call this after provisioning to pin the domain rule to read-only
 * regardless of the org default. No-op if no domain rule exists (404) or it's already read-only.
 */
export async function enforceDomainReadOnly(googleCalendarId: string): Promise<void> {
  const client = getClient();
  const domain = getWorkspaceDomain();
  const ruleId = `domain:${domain}`;

  let existing: calendar_v3.Schema$AclRule;
  try {
    const res = await client.acl.get({ calendarId: googleCalendarId, ruleId });
    existing = res.data;
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 404) return;
    throw err;
  }

  if (existing.role === 'freeBusyReader' || existing.role === 'none') return;

  await client.acl.update({
    calendarId: googleCalendarId,
    ruleId,
    requestBody: { role: 'freeBusyReader', scope: { type: 'domain', value: domain } },
  });
}
