# TASK — Giorni lavorativi paese-aware per criticità calendario

> **IMPLEMENTATO 2026-07-10** (stessa sessione in cui è stato scritto questo documento).
> Questo file resta come design doc storico/di riferimento — vedi anche
> `docs/TASK_calendar_ux_deferred_items.md` §6 per l'altra feature implementata insieme.
> Una differenza rispetto al design originale: nessuna nuova chiave AppConfig né campo
> aggiuntivo per il paese azienda — riusa `CompanyProfile.countryCode` esistente, come già
> previsto qui sotto. Un'altra: `resolveCompanyCountryCode` è stato estratto in
> `apps/api/src/services/companyProfile.service.ts` (condiviso con `holidays.ts`) durante il
> ciclo /simplify, non tenuto locale a `phaseAlert.service.ts` come nella bozza fasi sotto.

## Istruzioni preliminari obbligatorie

> Leggi `CLAUDE.md` e `lessons.md` prima di qualsiasi altra cosa. Le convenzioni lì hanno
> precedenza assoluta su questo documento.

> **Non reintrodurre il what-if solver.** Il campo `relevantCountries` per-evento e l'intero
> dependency-solver (`packages/calendar/src/solver/`) sono stati rimossi il 2026-07-01 per
> eccesso di configurazione a basso valore d'uso — vedi `docs/archive/what-if-calendar-solver.md`.
> Questo task **non** reintroduce quel meccanismo: nessun multi-select paesi libero sull'evento,
> nessun grafo di dipendenze, nessuna simulazione drag-preview. Solo un enum a 3 valori che
> eredita paesi da dati già esistenti (vendor riga, profilo azienda).

## Contesto

Emerso durante UX review del flusso calendario/pianificazione/alert (sessione 2026-07-10).
`phaseAlert.service.ts` calcola `daysToDeadline` con `daysBetween()` — giorni di calendario
puri (weekend inclusi, nessun festivo escluso). Per fasi legate a produzione presso vendor
esteri (es. campionario in Cina), questo sovrastima il tempo realmente disponibile: un giorno
di festività cinese non è un giorno lavorativo per quella fase, anche se in Italia si lavora
normalmente. Serve un modo per far contare solo i giorni lavorativi rilevanti, senza
reintrodurre la complessità di configurazione tolta a luglio.

## Dati già esistenti da riusare (nessuna nuova infrastruttura dati generica)

- `packages/core/src/utils/dateUtils.ts` — `isWorkingDay()` / `workingDaysBetween()`: già
  scritte, mai chiamate da nessuna parte (dead code). Accettano `countryCodes: string[]` +
  lista `WorkingDayHoliday[]`. **Nota di design importante**: se si passa più di un country
  code (es. `[IT, CN]`), una data viene esclusa se è festivo in **uno qualsiasi** dei paesi
  passati — questo dà gratis la semantica "intersezione dei giorni aperti in entrambi" per
  la modalità BOTH, senza scrivere nuova logica di combinazione.
- `Vendor.countryCode` (`schema.prisma:576`) — paese del vendor assegnato alla riga.
- `CollectionLayoutRow.vendorId` (opzionale, `schema.prisma` ~628-631) — collega riga a vendor.
- `CompanyProfile.countryCode` (`schema.prisma:1514`) — singleton, popolato da
  `company.profile.update` (settings/company), derivato da `address.countryCode`. **Usare
  questo per il paese "azienda", non creare una chiave AppConfig.**
- `HolidayCountry` / `Holiday` (`schema.prisma:2174-2213`) — calendario festivi per paese,
  già popolato/sincronizzato, già filtrabile per `countryCode`.

## Design

Un solo campo enum, opzionale, su `CalendarEvent` e `MilestoneTemplateItem`:

```prisma
enum CalendarDaysRelevance {
  COMPANY   // giorni lavorativi contro festività CompanyProfile.countryCode
  VENDOR    // giorni lavorativi contro festività Vendor.countryCode della riga
  BOTH      // intersezione: giorno conta solo se lavorativo in entrambi
}
```

- Campo nullable, default `null` su record esistenti e nuovi non taggati esplicitamente —
  **zero regressione**: eventi senza il campo settato continuano a usare `daysBetween()`
  (giorni di calendario) esattamente come oggi.
- Propagazione: `MilestoneTemplateItem.calendarDaysRelevance` → copiato su `CalendarEvent`
  quando il template viene applicato (`applyTemplate`), stesso pattern già usato per `phaseId`.

### Risoluzione country-list per riga, a calcolo (non salvata sull'evento)

In `phaseAlert.service.ts`, quando l'evento attivo ha `calendarDaysRelevance` settato:

| Modalità | countryCodes passati a `workingDaysBetween` | Fallback se ignoto |
|---|---|---|
| `COMPANY` | `[CompanyProfile.countryCode]` | se null → nessun paese, solo weekend |
| `VENDOR` | `[row.vendor.countryCode]` | se riga senza vendor o vendor senza countryCode → solo weekend |
| `BOTH` | `[companyCountry, vendorCountry].filter(Boolean)` | se uno dei due manca, degrada all'altro solo; se entrambi mancano → solo weekend |

"Solo weekend" = chiamare `workingDaysBetween` con `holidays: []` (non con `countryCodes: []`,
perché `isWorkingDay` con `countryCodes` vuoto applica **tutti** i festivi di **tutti** i
paesi, comportamento opposto a quello voluto — vedi commento in `dateUtils.ts:36`).

### Cosa cambia, concretamente

- `apps/api/prisma/schema.prisma` — nuovo enum + 2 colonne nullable (`CalendarEvent`,
  `MilestoneTemplateItem`). Migration seguendo workflow standard (`docs/release-process.md`
  / regola in `CLAUDE.md` §Prisma Migration Workflow).
- `packages/core/src/schemas/seasonCalendar.ts` — aggiungere `calendarDaysRelevance` opzionale
  a `CalendarEventBaseSchema` e `MilestoneTemplateItemBaseSchema`.
- `apps/api/src/services/phaseAlert.service.ts` — `criticalityFromActivePhase` (e per coerenza
  `computeSchedulingVariance`, stesso evento/stessa fase) usano `workingDaysBetween` invece di
  `daysBetween` quando il campo è settato; serve fetch mirato di `Holiday` per i country code
  risolti nel range di date rilevante (riuso pattern batch già presente per
  `getCalendarEventsForLayout`).
- `apps/web/.../CalendarEventDialog.tsx`, `TemplateItemDialog.tsx` — select 3 opzioni
  (+ "nessuna", cioè null) accanto al campo fase, stesso ingombro UI di `PhaseSelect`. Helper
  text mostra il paese risolto in sola lettura (es. "Fornitore: Cina" o "Azienda: Italia") —
  **non editabile inline**, sempre derivato, mai un campo libero.
- `CriticalityBadge.tsx` / istanza tabella (`CollectionGroupSection.tsx`) — tooltip (già in
  piano come finding #4 della UX review) distingue "N gg lavorativi (calendario fornitore CN)"
  da "N gg di calendario" quando il campo non è settato.

## Esplicitamente fuori scope

- Nessun solver di dipendenze tra milestone.
- Nessun multi-select paesi libero sull'evento (il paese è sempre derivato, mai inserito).
- Nessuna modifica alle soglie dello scheduler notifiche (`milestoneDeadlineScheduler.ts`,
  48h/3gg) — restano in giorni di calendario, fuori scope per questo task.
- Nessuna nuova chiave AppConfig — riuso `CompanyProfile.countryCode` esistente.

## Fasi implementazione (quando si procede)

1. Migration Prisma (enum + 2 colonne nullable) + rigenerare client.
2. Schema Zod (`@luke/core`) + build package.
3. `phaseAlert.service.ts`: risoluzione country-list + switch `daysBetween`/`workingDaysBetween`.
4. Propagazione template → evento in `applyTemplate`.
5. UI: select relevance in `CalendarEventDialog`/`TemplateItemDialog` + helper text paese risolto.
6. Tooltip badge criticità aggiornato (si aggancia a finding #4 della UX review calendario).
7. Verifica manuale: evento marcato VENDOR su riga con vendor cinese, controllare che un
   festivo cinese noto nel periodo non venga contato come giorno disponibile.
