/**
 * Declaration of the tRPC procedures **not invoked** by the integration
 * suite, and the gate that verifies it.
 *
 * See `helpers/procedureUsage.ts` for why the "invoked" set is measured
 * instead of declared, and for the two stated limits of the measurement.
 *
 * ## Granularity
 *
 * Per namespace, not per procedure. There are 314 across 34 namespaces: a
 * per-procedure map would be ~280 lines on day one, almost all "not yet
 * covered" — a file nobody reads, i.e. ceremony.
 *
 * ## The count is not a promise, it's verified
 *
 * The gate computes how many procedures in the namespace were actually not
 * invoked and compares it against `uncovered`. A new procedure without tests
 * raises the real number and the comparison fails; the number falls — and the
 * comparison fails again, forcing a decrement — either when a test starts
 * invoking a procedure that wasn't covered, or when an uncovered procedure is
 * removed from the router. In every case the decision has to be made while
 * there's still context for it, not six months later.
 *
 * Accepted blind spot: a swap (one procedure removed, one added) leaves the
 * count stable. The escape hatch is per-namespace — `uncovered` also accepts
 * an explicit list of paths where precision is needed.
 */

import {
  namespaceOf,
  type UsageArtifact,
} from './helpers/procedureCoverageShared';

export interface UncoveredDeclaration {
  /** Why it isn't covered. A true sentence, not a placeholder. */
  reason: string;
  /** How many procedures remain uninvoked, or the explicit list of paths. */
  uncovered: number | string[];
}

/** Minimum length for a reason to plausibly be a sentence. */
const MIN_REASON_LENGTH = 15;

/** Reasons that aren't reasons. */
const PLACEHOLDER_REASONS = [/^todo\b/i, /^da fare\b/i, /^-+$/, /^n\/?a$/i];

/**
 * Namespaces whose procedures aren't reached by the integration suite.
 *
 * State as of 2026-08-30: **95 procedures invoked out of 314**, 30%. The
 * number is deliberately spelled out here: it's the measurement, not a goal
 * reached. The suite started out focused on auth, RBAC, audit, idempotency
 * and rate limiting — i.e. the cross-cutting mechanisms — and the
 * application domains are almost all uncovered.
 *
 * The reasons are written by hand, not generated. Where the reason is
 * "nobody has tested this yet" it should be stated as such: masking it
 * behind a technical formula would turn the file into reassurance instead
 * of an inventory.
 */
export const UNCOVERED_NAMESPACES: Record<string, UncoveredDeclaration> = {
  // ── Partially invoked: the suite touches them, but glancingly ─────────────
  auth: {
    reason:
      'login, refreshToken, confirmPasswordReset and requestPasswordReset covered (rate limit, idempotency, role demotion, password policy on the reset token, the SEC-A takeover chain); the rest is email flows, which need a real SMTP server',
    uncovered: 5,
  },
  brand: {
    reason:
      'create/list/update/hardDelete covered; the soft-delete cycle (remove, restore) and unlink from NAV remain',
    uncovered: 3,
  },
  company: {
    reason:
      'structure and teams covered on the main path; getById, reorder, restore and updateMemberRole remain',
    uncovered: 5,
  },
  config: {
    reason:
      'set, viewValue and importJson covered by the audit/idempotency/write-authority specs; list, exportJson and delete by the spec on the row whose key left the registry; the multi-key reads, setMultiple and update remain',
    uncovered: 3,
  },
  me: {
    reason:
      'changePassword, get and revokeAllSessions covered by the session specs; changeEmail, profile, timezone and the daily greeting are not',
    uncovered: 5,
  },
  users: {
    reason:
      'CRUD covered by the audit/idempotency specs; approvePending by the spec on mandatory team assignment; forceLocalAccess and revokeLocalAccess by the spec on the LDAP/OIDC bypass (usersLocalAccess.integration.spec.ts); heartbeat and the menu preferences are not',
    uncovered: 7,
  },
  seasonCalendar: {
    reason:
      'listMilestones and grantUserVisibility by the visibility spec (brand scope + grant hardening), getOrCreate by the brand-scope one, createMilestone by the digest, rescheduleMilestone/cancelMilestone/updateMilestone/deleteMilestone by the lifecycle spec, createTemplate/updateTemplate by the core-schema spec; it is the largest domain in the app, and its coverage has to be built milestone by milestone, not in one go',
    uncovered: 22,
  },
  integrations: {
    reason:
      'saveLdapConfig, mail.saveConfig, which only writes AppConfig, and auth.testLdapSearch, whose input is refused before any directory is contacted; everything else talks to real external systems (NAV via mssql, Google OAuth, SMTP, S3 storage) and needs a fake layer before it can be tested',
    uncovered: 22,
  },

  // ── Depend on an external system or on data the suite doesn't have ────────
  sales: {
    reason:
      'reads the PostgreSQL replica of NAV: without synced data the queries have nothing to run against',
    uncovered: 8,
  },
  holidays: {
    reason:
      'imports from the public Nager.Date API; testing it first needs the HTTP client stubbed',
    uncovered: 11,
  },
  storage: {
    reason:
      'saveConfig and getConfig covered by the write-authority and AppConfig-defaults specs; the rest are operations on real files through IStorageProvider, and MockStorageProvider is wired only into the brandLogo specs',
    uncovered: 3,
  },
  maintenance: {
    reason:
      'backup/restore and maintenance mode are destructive by construction: turning them on inside the suite would block the specs that follow',
    uncovered: 14,
  },
  system: {
    reason:
      'triggerCalendarDigest sends real notifications: invoking it from the suite would send real emails',
    uncovered: ['system.triggerCalendarDigest'],
  },

  // ── Application domains with no tests at all: to be written ───────────────
  collectionLayout: {
    reason:
      'the brand-scope spec invokes almost the whole domain to check the guards, so *access* coverage is high; the exports and `copyFromSeason` remain uncovered, and they need testing for what they produce, not for who can call them',
    uncovered: 4,
  },
  notifications: {
    reason: 'no tests written, including the preferences and the SSE ticket',
    uncovered: 10,
  },
  dashboard: {
    reason:
      'only `getSeasonProgress`, from the brand-scope spec; config, tasks, KPIs, exchange rates and weekly sales remain',
    uncovered: 8,
  },
  vendors: {
    reason:
      'no tests written. Same CRUD + soft-delete pattern as brand, which is covered',
    uncovered: 7,
  },
  season: {
    reason:
      'no tests written. Same CRUD + soft-delete pattern as brand, which is covered',
    uncovered: 7,
  },
  phase: {
    reason:
      'list, listAll, create, update, reorder and remove covered by phase.integration.spec.ts (deriving code from order, admin-only RBAC, the guard on phases still in use); restore remains, unchanged from the soft-delete pattern already used elsewhere',
    uncovered: 1,
  },
  collectionCatalog: {
    reason: 'no tests written on the configurable option lists',
    uncovered: 7,
  },
  collectionLayoutRevision: {
    reason:
      'list, getDetail, getLayoutAsOf and export.xlsx invoked by the brand-scope spec, `create` by the one on the automatic-types guard; export.pdf remains',
    uncovered: 1,
  },
  phaseAlert: {
    reason:
      'criticalityForRow and bottleneckByEvent are invoked by collectionRowCompletion.integration.spec.ts (the outcome of a completed row, and excluding completed rows from the bottleneck index); the two aggregate reads and the thresholds get/update pair remain uncovered',
    uncovered: 4,
  },
  planningGroup: {
    reason: 'no tests written, even though it is the scope of events and layout rows',
    uncovered: 4,
  },
  auditLog: {
    reason:
      '`auditlog.integration.spec.ts` checks the written rows mostly by querying Prisma directly, besides invoking `list`; getLastChange/getExportLink remain uncovered',
    uncovered: 2,
  },
  editLock: {
    reason: 'no tests written on the session lock of the planning wizard',
    uncovered: 3,
  },
  catalog: {
    reason:
      'no tests written on the brand/season lists filtered by the user whitelist',
    uncovered: 2,
  },
  context: {
    reason:
      'no tests on the router. `context.service` is covered by companyAccess, the two get/set procedures are not',
    uncovered: 2,
  },
  public: {
    reason:
      'passwordPolicy is covered by passwordPolicy.integration.spec.ts; appInfo remains, which reads a single key and has a hardcoded fallback',
    uncovered: 1,
  },
};

interface CoverageResult {
  discovered: string[];
  invoked: Set<string>;
}

/**
 * Reconciles the worker artifacts into a single result.
 *
 * Each artifact carries its own `discovered`: if two specs disagree on what
 * the router contains, something went wrong and it must be reported, not
 * averaged away.
 */
export function mergeArtifacts(artifacts: UsageArtifact[]): CoverageResult {
  if (artifacts.length === 0) {
    throw new Error(
      '[procedure-coverage] no artifacts: the recorder did not run in any ' +
        'spec. Check `setupFiles` in vitest.integration.config.mts.'
    );
  }

  const reference = artifacts[0];
  for (const artifact of artifacts.slice(1)) {
    if (
      artifact.discovered.length !== reference.discovered.length ||
      artifact.discovered.some((p, i) => p !== reference.discovered[i])
    ) {
      throw new Error(
        '[procedure-coverage] two specs observed different routers ' +
          `("${reference.specFile}" vs "${artifact.specFile}"). The procedure ` +
          'inventory is not deterministic: the gate cannot make a call.'
      );
    }
  }

  const invoked = new Set<string>();
  for (const artifact of artifacts) {
    for (const path of artifact.invoked) invoked.add(path);
  }

  return { discovered: reference.discovered, invoked };
}

/** Lines ready to paste into `UNCOVERED_NAMESPACES`. */
function pasteBlock(entries: [string, string[]][]): string {
  return entries
    .map(
      ([ns, paths]) =>
        `  ${ns}: { reason: '<reason>', uncovered: ${paths.length} },`
    )
    .join('\n');
}

/**
 * Applies the gate. Throws with a message that already contains the fix.
 */
export function assertProcedureCoverage(
  artifacts: UsageArtifact[],
  declarations: Record<string, UncoveredDeclaration> = UNCOVERED_NAMESPACES
): void {
  const { discovered, invoked } = mergeArtifacts(artifacts);

  // namespace → uninvoked procedures
  const uncoveredByNs = new Map<string, string[]>();
  const allNamespaces = new Set<string>();
  for (const path of discovered) {
    const ns = namespaceOf(path);
    allNamespaces.add(ns);
    if (!invoked.has(path)) {
      const list = uncoveredByNs.get(ns) ?? [];
      list.push(path);
      uncoveredByNs.set(ns, list);
    }
  }

  const problems: string[] = [];

  // 1. Namespaces with uninvoked procedures and no declaration.
  const undeclared = [...uncoveredByNs.entries()]
    .filter(([ns]) => !(ns in declarations))
    .sort(([a], [b]) => a.localeCompare(b));
  if (undeclared.length > 0) {
    problems.push(
      `${undeclared.length} namespaces have procedures that are never invoked and no ` +
        'declaration. Add them to UNCOVERED_NAMESPACES in ' +
        'test/procedure-coverage.ts, replacing <reason> with a real sentence:\n\n' +
        pasteBlock(undeclared) +
        '\n\nAffected procedures:\n' +
        undeclared
          .map(([ns, paths]) => `  ${ns}: ${paths.join(', ')}`)
          .join('\n')
    );
  }

  for (const [ns, declaration] of Object.entries(declarations).sort()) {
    const uncovered = uncoveredByNs.get(ns) ?? [];

    // 2. Declaration for a namespace that no longer exists.
    if (!allNamespaces.has(ns)) {
      problems.push(
        `"${ns}" is no longer a router namespace: the entry is stale and ` +
          'pretends to decide something that does not exist. Remove it.'
      );
      continue;
    }

    // 3. Namespace now fully invoked: coverage isn't earned by leaving the
    //    declaration in place.
    if (uncovered.length === 0) {
      problems.push(
        `"${ns}" is now fully invoked by the suite. Remove its entry from ` +
          'UNCOVERED_NAMESPACES.'
      );
      continue;
    }

    // 4. Missing or placeholder reason.
    const reason = declaration.reason?.trim() ?? '';
    if (
      reason.length < MIN_REASON_LENGTH ||
      PLACEHOLDER_REASONS.some(re => re.test(reason))
    ) {
      problems.push(
        `"${ns}" has a missing or placeholder reason ("${reason}"). A ` +
          'declaration without a written reason is a declaration nobody has ' +
          'thought about.'
      );
    }

    // 5. The declared count (or list) must match the measurement.
    if (Array.isArray(declaration.uncovered)) {
      const declared = [...declaration.uncovered].sort();
      const actual = [...uncovered].sort();
      const missing = actual.filter(p => !declared.includes(p));
      const stale = declared.filter(p => !actual.includes(p));
      if (missing.length > 0 || stale.length > 0) {
        problems.push(
          `"${ns}": the declared list does not match the measurement.` +
            (missing.length > 0
              ? `\n  Uninvoked and undeclared: ${missing.join(', ')}`
              : '') +
            (stale.length > 0
              ? `\n  Declared but now invoked (or nonexistent): ${stale.join(', ')}`
              : '')
        );
      }
    } else if (declaration.uncovered !== uncovered.length) {
      const direction =
        uncovered.length > declaration.uncovered
          ? 'new procedures appeared without tests'
          : 'the suite invokes more of them, or some were removed from the ' +
            'router: check which of the two and decrement the number';
      problems.push(
        `"${ns}": ${declaration.uncovered} uninvoked procedures declared, ` +
          `${uncovered.length} measured — ${direction}.\n` +
          `  Uninvoked: ${uncovered.join(', ')}`
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `[procedure-coverage] the gate has ${problems.length} findings.\n` +
        'Note: a suite that is already red can cascade findings here — fix the ' +
        'failed tests first.\n\n' +
        problems.join('\n\n')
    );
  }
}
