/**
 * Dichiarazione delle procedure tRPC **non invocate** dalla suite di
 * integrazione, e il gate che la verifica.
 *
 * Leggi `helpers/procedureUsage.ts` per il perché l'insieme "invocato" è
 * misurato invece che dichiarato, e per i due limiti dichiarati della misura.
 *
 * ## Granularità
 *
 * Per namespace, non per procedura. Ce ne sono 309 su 34 namespace: una mappa
 * per-procedura sarebbe ~280 righe il primo giorno, quasi tutte "non ancora
 * coperto" — un file che nessuno legge, cioè cerimonia.
 *
 * ## Il conteggio non è una promessa, è verificato
 *
 * Il gate calcola quante procedure del namespace non sono state invocate davvero
 * e lo confronta con `uncovered`. Una procedura nuova senza test alza il numero
 * reale e il confronto fallisce; un test nuovo lo abbassa e fallisce di nuovo,
 * obbligando a decrementarlo. In entrambi i casi la decisione va presa quando si
 * ha il contesto per prenderla, non sei mesi dopo.
 *
 * Punto cieco accettato: uno scambio (una procedura tolta, una aggiunta) lascia
 * il conteggio stabile. La via d'uscita è per-namespace — `uncovered` accetta
 * anche l'elenco esplicito dei path dove serve precisione.
 */

import {
  namespaceOf,
  type UsageArtifact,
} from './helpers/procedureCoverageShared';

export interface UncoveredDeclaration {
  /** Perché non è coperto. Una frase vera, non un segnaposto. */
  reason: string;
  /** Quante procedure restano non invocate, o l'elenco esplicito dei path. */
  uncovered: number | string[];
}

/** Lunghezza minima di un motivo perché sia plausibilmente una frase. */
const MIN_REASON_LENGTH = 15;

/** Motivi che non sono motivi. */
const PLACEHOLDER_REASONS = [/^todo\b/i, /^da fare\b/i, /^-+$/, /^n\/?a$/i];

/**
 * Namespace le cui procedure non sono raggiunte dalla suite di integrazione.
 *
 * Stato al 2026-07-30: **28 procedure invocate su 309**, il 9%. Il numero è
 * volutamente in chiaro qui: è la misura, non un obiettivo raggiunto. La suite
 * nasce concentrata su auth, RBAC, audit, idempotenza e rate limit — cioè sui
 * meccanismi trasversali — e i domini applicativi sono quasi tutti scoperti.
 *
 * I motivi sono scritti a mano, non generati. Dove il motivo è "nessuno l'ha
 * ancora testato" va detto così: mascherarlo dietro una formula tecnica
 * renderebbe il file una rassicurazione invece di un inventario.
 */
export const UNCOVERED_NAMESPACES: Record<string, UncoveredDeclaration> = {
  // ── Parzialmente invocati: la suite li tocca, ma di striscio ──────────────
  auth: {
    reason:
      'login e refreshToken coperte (rate limit, idempotenza, retrocessione di ruolo); il resto è flussi email e reset password, che richiedono SMTP e token reali',
    uncovered: 10,
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
      'set e viewValue coperte dalle spec audit/idempotenza; export/import JSON e le letture multiple non hanno test',
    uncovered: 9,
  },
  me: {
    reason:
      'changePassword, get e revokeAllSessions coperte dalle spec sessione; profilo, timezone e saluto giornaliero no',
    uncovered: 6,
  },
  users: {
    reason:
      'CRUD coperto dalle spec audit/idempotenza; il flusso di approvazione utenti pending, heartbeat e le preferenze menu no',
    uncovered: 11,
  },
  seasonCalendar: {
    reason:
      'listMilestones dalla spec sulla visibilità e getOrCreate da quella sul brand scope; è il dominio più grande dell’app e la copertura va costruita per milestone, non in un colpo',
    uncovered: 29,
  },
  integrations: {
    reason:
      'solo saveLdapConfig; tutto il resto parla con sistemi esterni reali (NAV via mssql, Google OAuth, SMTP, MinIO) e serve un layer di fake prima di poter testare',
    uncovered: 27,
  },

  // ── Dipendono da un sistema esterno o da dati che la suite non ha ─────────
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
      'operazioni su file reali via IStorageProvider; il MockStorageProvider esiste ma è cablato solo nelle spec brandLogo',
    uncovered: 10,
  },
  maintenance: {
    reason:
      'backup/restore e modalità manutenzione sono distruttivi per costruzione: attivarli dentro la suite bloccherebbe le spec successive',
    uncovered: 16,
  },
  feedback: {
    reason: 'apre una issue GitHub reale usando il token configurato',
    uncovered: 1,
  },
  system: {
    reason:
      'about legge le versioni delle dipendenze, triggerCalendarDigest invia notifiche reali',
    uncovered: 2,
  },

  // ── Domini applicativi senza alcun test: da scrivere ──────────────────────
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
  sectionAccess: {
    reason:
      'nessun test sul router. La logica sottostante (`effectiveSectionAccess`) è coperta in packages/core e in sectionAccess.spec.ts, le procedure di override no',
    uncovered: 6,
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
      'nessun test sulle procedure di lettura. `auditlog.integration.spec.ts` verifica le righe scritte interrogando Prisma, non list/getLastChange/getExportLink',
    uncovered: 3,
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
    reason: 'nessun test scritto su appInfo, unico endpoint non autenticato',
    uncovered: 1,
  },
};

interface CoverageResult {
  discovered: string[];
  invoked: Set<string>;
}

/**
 * Riconcilia gli artefatti dei worker in un unico risultato.
 *
 * Ogni artefatto porta il proprio `discovered`: se due spec non concordano su
 * cosa contenga il router, qualcosa è andato storto e va detto, non mediato.
 */
export function mergeArtifacts(artifacts: UsageArtifact[]): CoverageResult {
  if (artifacts.length === 0) {
    throw new Error(
      '[procedure-coverage] nessun artefatto: il recorder non ha girato in ' +
        'nessuna spec. Verifica `setupFiles` in vitest.integration.config.ts.'
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

/** Righe pronte da incollare in `UNCOVERED_NAMESPACES`. */
function pasteBlock(entries: [string, string[]][]): string {
  return entries
    .map(
      ([ns, paths]) =>
        `  ${ns}: { reason: '<motivo>', uncovered: ${paths.length} },`
    )
    .join('\n');
}

/**
 * Applica il gate. Lancia con un messaggio che contiene già la correzione.
 */
export function assertProcedureCoverage(
  artifacts: UsageArtifact[],
  declarations: Record<string, UncoveredDeclaration> = UNCOVERED_NAMESPACES
): void {
  const { discovered, invoked } = mergeArtifacts(artifacts);

  // namespace → procedure non invocate
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

  // 1. Namespace con procedure non invocate e nessuna dichiarazione.
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

    // 2. Dichiarazione per un namespace che non esiste più.
    if (!allNamespaces.has(ns)) {
      problems.push(
        `"${ns}" non è più un namespace del router: la voce è stale e finge ` +
          'una decisione su qualcosa che non esiste. Rimuovila.'
      );
      continue;
    }

    // 3. Namespace ormai interamente invocato: la copertura non si guadagna
    //    senza cancellare la dichiarazione.
    if (uncovered.length === 0) {
      problems.push(
        `"${ns}" è ora interamente invocato dalla suite. Rimuovi la voce da ` +
          'UNCOVERED_NAMESPACES.'
      );
      continue;
    }

    // 4. Motivo assente o segnaposto.
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

    // 5. Il conteggio (o l'elenco) dichiarato deve combaciare con la misura.
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
