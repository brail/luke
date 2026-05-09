import { getClient } from './client.js';

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
