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
 * raises the real number and the comparison fails; a new test lowers it and
 * fails again, forcing a decrement. In both cases the decision has to be made
 * while there's still context for it, not six months later.
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
      'login, refreshToken e confirmPasswordReset coperte (rate limit, idempotenza, retrocessione di ruolo, policy password sul token di reset); il resto è flussi email, che richiedono SMTP reale',
    uncovered: 9,
  },
  brand: {
    reason:
      'create/list/update/hardDelete coperte; restano il ciclo soft delete (remove, restore) e unlink da NAV',
    uncovered: 3,
  },
  company: {
    reason:
      'struttura e team coperti sul percorso principale; restano getById, reorder, restore e updateMemberRole',
    uncovered: 6,
  },
  config: {
    reason:
      'set, viewValue e importJson coperte dalle spec audit/idempotenza/autorità in scrittura; exportJson e le letture multiple non hanno test',
    uncovered: 8,
  },
  me: {
    reason:
      'changePassword, get e revokeAllSessions coperte dalle spec sessione; changeEmail, profilo, timezone e saluto giornaliero no',
    uncovered: 5,
  },
  users: {
    reason:
      'CRUD coperto dalle spec audit/idempotenza; approvePending dalla spec sull\'assegnazione team obbligatoria (Piano C); forceLocalAccess e revokeLocalAccess dalla spec sul bypass LDAP/OIDC (usersLocalAccess.integration.spec.ts); heartbeat e le preferenze menu no',
    uncovered: 9,
  },
  seasonCalendar: {
    reason:
      'listMilestones e grantUserVisibility dalla spec sulla visibilità (brand scope + hardening del grant), getOrCreate da quella sul brand scope, createMilestone dal digest, rescheduleMilestone/cancelMilestone/updateMilestone/deleteMilestone dalla spec sul ciclo di vita; è il dominio più grande dell’app e la copertura va costruita per milestone, non in un colpo',
    uncovered: 24,
  },
  integrations: {
    reason:
      'solo saveLdapConfig; tutto il resto parla con sistemi esterni reali (NAV via mssql, Google OAuth, SMTP, storage S3) e serve un layer di fake prima di poter testare',
    uncovered: 27,
  },

  // ── Depend on an external system or on data the suite doesn't have ────────
  sales: {
    reason:
      'legge la replica PostgreSQL di NAV: senza dati sincronizzati le query non hanno nulla su cui girare',
    uncovered: 8,
  },
  holidays: {
    reason:
      'importa dall’API pubblica Nager.Date; testarlo richiede prima di stubbare il client HTTP',
    uncovered: 11,
  },
  storage: {
    reason:
      'saveConfig coperta dalla spec sull\'autorità in scrittura di AppConfig; il resto sono operazioni su file reali via IStorageProvider e il MockStorageProvider è cablato solo nelle spec brandLogo',
    uncovered: 9,
  },
  maintenance: {
    reason:
      'backup/restore e modalità manutenzione sono distruttivi per costruzione: attivarli dentro la suite bloccherebbe le spec successive',
    uncovered: 16,
  },
  system: {
    reason:
      'about legge le versioni delle dipendenze, triggerCalendarDigest invia notifiche reali',
    uncovered: 2,
  },

  // ── Application domains with no tests at all: to be written ───────────────
  collectionLayout: {
    reason:
      'la spec sul brand scope invoca quasi tutto il dominio per verificare i guard, quindi la copertura di *accesso* è alta; restano scoperti gli export e `copyFromSeason`, che vanno testati per quello che producono, non per chi li può chiamare',
    uncovered: 4,
  },
  merchandisingPlan: {
    reason:
      'nessun test scritto: piano, righe, specsheet, componenti e immagini sono tutti scoperti',
    uncovered: 14,
  },
  notifications: {
    reason: 'nessun test scritto, incluse le preferenze e il ticket SSE',
    uncovered: 10,
  },
  dashboard: {
    reason:
      'solo `getSeasonProgress`, dalla spec sul brand scope; restano config, task, KPI, cambi e vendite settimanali',
    uncovered: 8,
  },
  vendors: {
    reason:
      'nessun test scritto. Stesso pattern CRUD + soft delete di brand, che invece è coperto',
    uncovered: 8,
  },
  season: {
    reason:
      'nessun test scritto. Stesso pattern CRUD + soft delete di brand, che invece è coperto',
    uncovered: 7,
  },
  phase: {
    reason:
      'list, listAll, create, update, reorder e remove coperte da phase.integration.spec.ts (derivazione di code da order, RBAC admin-only, guard sulle fasi ancora in uso); resta restore, invariata rispetto al pattern soft-delete già in uso altrove',
    uncovered: 1,
  },
  collectionCatalog: {
    reason: 'nessun test scritto sulle liste di opzioni configurabili',
    uncovered: 7,
  },
  collectionLayoutRevision: {
    reason:
      'list, getDetail, getLayoutAsOf ed export.xlsx invocate dalla spec sul brand scope, `create` da quella sul guard dei tipi automatici; resta export.pdf',
    uncovered: 1,
  },
  phaseAlert: {
    reason:
      'criticalityForRow e bottleneckByEvent sono invocate da collectionRowCompletion.integration.spec.ts (esito di una riga conclusa, ed esclusione delle concluse dall\'indice di strozzatura); restano scoperte le due letture aggregate e la coppia get/update delle soglie',
    uncovered: 4,
  },
  planningGroup: {
    reason: 'nessun test scritto, benché sia lo scope di eventi e righe layout',
    uncovered: 4,
  },
  auditLog: {
    reason:
      '`auditlog.integration.spec.ts` verifica le righe scritte perlopiù interrogando Prisma direttamente, oltre a invocare `list`; getLastChange/getExportLink restano scoperte',
    uncovered: 2,
  },
  editLock: {
    reason: 'nessun test scritto sul lock di sessione del wizard di pianificazione',
    uncovered: 3,
  },
  catalog: {
    reason:
      'nessun test scritto sulle liste brand/stagione filtrate per whitelist utente',
    uncovered: 2,
  },
  context: {
    reason:
      'nessun test sul router. `context.service` è coperto da companyAccess, le due procedure get/set no',
    uncovered: 2,
  },
  health: {
    reason:
      'nessun test scritto. Il readiness HTTP è coperto da readyz, questa è la sonda sul layer di contesto',
    uncovered: 1,
  },
  public: {
    reason:
      'passwordPolicy è coperta da passwordPolicy.integration.spec.ts; resta appInfo, che legge una sola chiave e ha fallback hardcoded',
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
      '[procedure-coverage] nessun artefatto: il recorder non ha girato in ' +
        'nessuna spec. Verifica `setupFiles` in vitest.integration.config.mts.'
    );
  }

  const reference = artifacts[0];
  for (const artifact of artifacts.slice(1)) {
    if (
      artifact.discovered.length !== reference.discovered.length ||
      artifact.discovered.some((p, i) => p !== reference.discovered[i])
    ) {
      throw new Error(
        '[procedure-coverage] due spec hanno osservato router diversi ' +
          `("${reference.specFile}" vs "${artifact.specFile}"). L'inventario ` +
          'delle procedure non è deterministico: il gate non può pronunciarsi.'
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
        `  ${ns}: { reason: '<motivo>', uncovered: ${paths.length} },`
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
      `${undeclared.length} namespace hanno procedure mai invocate e nessuna ` +
        'dichiarazione. Aggiungili a UNCOVERED_NAMESPACES in ' +
        'test/procedure-coverage.ts, sostituendo <motivo> con una frase vera:\n\n' +
        pasteBlock(undeclared) +
        '\n\nProcedure interessate:\n' +
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
        `"${ns}" non è più un namespace del router: la voce è stale e finge ` +
          'una decisione su qualcosa che non esiste. Rimuovila.'
      );
      continue;
    }

    // 3. Namespace now fully invoked: coverage isn't earned by leaving the
    //    declaration in place.
    if (uncovered.length === 0) {
      problems.push(
        `"${ns}" è ora interamente invocato dalla suite. Rimuovi la voce da ` +
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
        `"${ns}" ha un motivo assente o segnaposto ("${reason}"). Una ` +
          'dichiarazione senza motivo scritto è una dichiarazione a cui nessuno ' +
          'ha pensato.'
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
          `"${ns}": l'elenco dichiarato non combacia con la misura.` +
            (missing.length > 0
              ? `\n  Non invocate e non dichiarate: ${missing.join(', ')}`
              : '') +
            (stale.length > 0
              ? `\n  Dichiarate ma ora invocate (o inesistenti): ${stale.join(', ')}`
              : '')
        );
      }
    } else if (declaration.uncovered !== uncovered.length) {
      const direction =
        uncovered.length > declaration.uncovered
          ? 'sono comparse procedure nuove senza test'
          : 'un test nuovo ne copre di più: decrementa il numero';
      problems.push(
        `"${ns}": dichiarate ${declaration.uncovered} procedure non invocate, ` +
          `ne risultano ${uncovered.length} — ${direction}.\n` +
          `  Non invocate: ${uncovered.join(', ')}`
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `[procedure-coverage] il gate ha ${problems.length} rilievi.\n` +
        'Nota: una suite già rossa può far cascare rilievi qui — sistema prima ' +
        'i test falliti.\n\n' +
        problems.join('\n\n')
    );
  }
}
