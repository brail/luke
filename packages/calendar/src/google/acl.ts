import { getClient, getWorkspaceDomain } from './client.js';
import { googleErrorStatus, withRetry } from './retry.js';

import type { calendar_v3 } from 'googleapis';

type AclRule = calendar_v3.Schema$AclRule;

/** An ACL rule Luke does not manage: reported, never changed. */
export interface UnmanagedAclRule {
  role: string;
  scopeType: string;
}

/** Outcome of `syncCalendarAcl`. */
export interface AclSyncResult {
  added: number;
  removed: number;
  /** Reader changes Google refused, after retries; the other changes were still made. */
  errors: unknown[];
  /** Rules Luke does not manage, left in place (see `unmanagedRules`). */
  unmanaged: UnmanagedAclRule[];
}

/** Every rule of a calendar's ACL, across all pages. */
async function listAclRules(calendarId: string): Promise<AclRule[]> {
  const client = getClient();
  const rules: AclRule[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() => client.acl.list({ calendarId, maxResults: 250, pageToken }));
    rules.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return rules;
}

/**
 * Rules Luke neither manages nor ignores: everything but the user-scoped `reader` rules, the
 * Workspace domain rule, `none` rules (they grant nothing) and a single `owner` (the account the
 * calendar was created by). That is another domain, a group, the public `default` scope, a user
 * `writer` or `freeBusyReader`, a second owner. They are reported, not removed: taking away access
 * Luke never granted is the Workspace admin's call.
 */
function unmanagedRules(rules: AclRule[], domain: string): UnmanagedAclRule[] {
  const owners = rules.filter(r => r.role === 'owner').length;
  return rules
    .filter(r => {
      const type = r.scope?.type;
      if (r.role === 'none') return false;
      if (r.role === 'reader' && type === 'user') return false;
      if (type === 'domain' && r.scope?.value?.toLowerCase() === domain) return false;
      if (r.role === 'owner') return owners > 1;
      return true;
    })
    .map(r => ({ role: r.role ?? 'unknown', scopeType: r.scope?.type ?? 'unknown' }));
}

/**
 * Brings a Google Calendar's ACL to what Luke grants, from one read of the whole ACL:
 *
 * - the user-scoped `reader` rules become exactly `expectedEmails`. Addresses are compared ignoring
 *   case (Google may store another case than Luke, and adding and removing the same rule in one
 *   pass could end with it removed); a rule is removed by the id Google gave it. An expected reader
 *   who already holds a user `writer` or `owner` rule reads already: nothing is inserted for them,
 *   since an insert on the same scope would replace that rule (the calendar's own owner is often
 *   an admin, hence an expected reader);
 * - the Workspace `domain:` rule is pinned to `freeBusyReader`. Google creates it on every calendar
 *   made inside a Workspace from the org's default sharing setting, which can grant edit access,
 *   and Google applies the most permissive rule matching a user, so it would override the per-user
 *   grants;
 * - every other rule is left in place and returned in `unmanaged`.
 *
 * Each change runs on its own through `withRetry`: one refused reader change does not stop the
 * others, and is returned in `errors`. A refused domain downgrade is thrown, after the reader
 * changes settle: a calendar whose whole domain may edit it must not count as reconciled.
 *
 * @param expectedEmails - Complete desired set of reader email addresses
 */
export async function syncCalendarAcl(
  googleCalendarId: string,
  expectedEmails: string[]
): Promise<AclSyncResult> {
  const client = getClient();
  const workspaceDomain = getWorkspaceDomain();
  const domain = workspaceDomain.toLowerCase();
  const rules = await listAclRules(googleCalendarId);

  const readers = rules.flatMap(r =>
    r.role === 'reader' && r.scope?.type === 'user' && r.scope.value && r.id
      ? [{ key: r.scope.value.toLowerCase(), id: r.id }]
      : []
  );
  const canRead = new Set([
    ...readers.map(r => r.key),
    ...rules.flatMap(r =>
      (r.role === 'writer' || r.role === 'owner') && r.scope?.type === 'user' && r.scope.value
        ? [r.scope.value.toLowerCase()]
        : []
    ),
  ]);
  const expected = new Map(expectedEmails.map(e => [e.toLowerCase(), e]));
  const toAdd = [...expected].filter(([key]) => !canRead.has(key)).map(([, email]) => email);
  const toRemove = readers.filter(r => !expected.has(r.key)).map(r => r.id);
  const permissiveDomainRuleId = rules.find(
    r =>
      r.scope?.type === 'domain' &&
      r.scope.value?.toLowerCase() === domain &&
      r.role !== 'freeBusyReader' &&
      r.role !== 'none'
  )?.id;

  const [adds, removes, pins] = await Promise.all([
    Promise.allSettled(
      toAdd.map(email =>
        withRetry(() =>
          client.acl.insert({
            calendarId: googleCalendarId,
            requestBody: { role: 'reader', scope: { type: 'user', value: email } },
          })
        )
      )
    ),
    Promise.allSettled(
      toRemove.map(async ruleId => {
        try {
          await withRetry(() => client.acl.delete({ calendarId: googleCalendarId, ruleId }));
        } catch (err: unknown) {
          // 404 = rule already gone, which is the state we want
          if (googleErrorStatus(err) !== 404) throw err;
        }
      })
    ),
    Promise.allSettled(
      permissiveDomainRuleId
        ? [
            withRetry(() =>
              client.acl.update({
                calendarId: googleCalendarId,
                ruleId: permissiveDomainRuleId,
                requestBody: { role: 'freeBusyReader', scope: { type: 'domain', value: workspaceDomain } },
              })
            ),
          ]
        : []
    ),
  ]);

  const [pinFailure] = pins.flatMap(r => (r.status === 'rejected' ? [r.reason] : []));
  if (pinFailure !== undefined) throw pinFailure;

  const fulfilled = (results: PromiseSettledResult<unknown>[]) =>
    results.filter(r => r.status === 'fulfilled').length;
  return {
    added: fulfilled(adds),
    removed: fulfilled(removes),
    errors: [...adds, ...removes].flatMap(r => (r.status === 'rejected' ? [r.reason] : [])),
    unmanaged: unmanagedRules(rules, domain),
  };
}
