import { getClient } from './client.js';

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
