import { getClient, getWorkspaceDomain } from './client.js';
import { googleErrorStatus, isGoneError, withRetry } from './retry.js';

import type { GoogleCalendarClient } from './client.js';
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
  /** Lowercase addresses inserted as readers in this pass. */
  inserted: string[];
  /**
   * Reader changes Google refused, after retries, and expected readers whose rule could not be
   * told apart (`lookUpReader`); the other changes were still made.
   */
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

/** Roles that let a user read the events. */
const READ_ROLES = new Set(['reader', 'writer', 'owner']);

/**
 * Asks Google whether an expected address the ACL does not list already reads the calendar under
 * another address — an alias: Google stores a user rule under the account's primary address (#243).
 *
 * `acl.get('user:<alias>')` answers 200 for an alias of an account holding a rule, echoing the alias,
 * and 404 for an address with none; the answer's `etag` equals that of the account's rule in
 * `acl.list`. Both are observed, not documented, Google behaviour (Google documents `etag` as the
 * rule's version): the `etag` is compared as an opaque string, and a missing or empty one never
 * matches.
 *
 * @returns The keys of the listed user rules to keep (several only if `etag`s collide), or none when
 *   the address has to be inserted: no rule (404), or one that cannot read (`freeBusyReader`, `none`).
 * @throws On any other error, or when no listed rule matches: nothing is inserted nor kept for the
 *   address, and revocation goes on — if the alias's own rule is removed, the next pass finds 404.
 */
async function lookUpReader(
  client: GoogleCalendarClient,
  calendarId: string,
  email: string,
  userRules: AclRule[]
): Promise<string[]> {
  let rule: AclRule;
  try {
    rule = (await withRetry(() => client.acl.get({ calendarId, ruleId: `user:${email}` }))).data;
  } catch (err: unknown) {
    if (googleErrorStatus(err) === 404) return [];
    throw err;
  }
  if (!READ_ROLES.has(rule.role ?? '')) return [];
  const keys = rule.etag
    ? userRules.flatMap(r => (r.etag === rule.etag && r.scope?.value ? [r.scope.value.toLowerCase()] : []))
    : [];
  if (keys.length === 0) throw new Error('Google holds a rule for an expected reader that matches no listed rule');
  return keys;
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
 *   an admin, hence an expected reader). An expected address not listed at all may be an alias
 *   (`lookUpReader`); doubt never suspends a removal. Inserts send Google's share email;
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

  const userRules = rules.filter(r => r.scope?.type === 'user' && r.scope.value);
  const keyOf = (r: AclRule) => r.scope?.value?.toLowerCase() ?? '';
  const listed = new Set(userRules.map(keyOf));
  const canRead = new Set(userRules.filter(r => READ_ROLES.has(r.role ?? '')).map(keyOf));
  const expected = new Map(expectedEmails.map(e => [e.toLowerCase(), e]));

  // Lookups one at a time: a calendar with many new readers must not burst Google's rate limit.
  const toAdd: string[] = [];
  const kept = new Set(expected.keys());
  const lookupErrors: unknown[] = [];
  for (const [key, email] of expected) {
    if (canRead.has(key)) continue;
    if (listed.has(key)) {
      toAdd.push(email);
      continue;
    }
    try {
      const keys = await lookUpReader(client, googleCalendarId, email, userRules);
      if (keys.length === 0) toAdd.push(email);
      keys.forEach(k => kept.add(k));
    } catch (err: unknown) {
      lookupErrors.push(err);
    }
  }
  const toRemove = userRules.flatMap(r => (r.role === 'reader' && r.id && !kept.has(keyOf(r)) ? [r.id] : []));
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
            // Owner decision (#243): a managed share keeps Google's email; the reconcile converges,
            // so it goes out only on a real grant.
            sendNotifications: true,
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
          // Rule already gone: the state we want.
          if (!isGoneError(err)) throw err;
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
  const inserted = toAdd.filter((_, i) => adds[i]?.status === 'fulfilled').map(e => e.toLowerCase());
  return {
    added: inserted.length,
    removed: fulfilled(removes),
    inserted,
    errors: [
      ...lookupErrors,
      ...[...adds, ...removes].flatMap(r => (r.status === 'rejected' ? [r.reason] : [])),
    ],
    unmanaged: unmanagedRules(rules, domain),
  };
}
