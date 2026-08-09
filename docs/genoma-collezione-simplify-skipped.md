# Genoma della Collezione — Findings skippati dai `/simplify`

Ogni fase del piano (`docs/genoma-collezione-pianificazione.md`) è stata seguita da una review
`/simplify` con 4 agenti paralleli (reuse, simplification, efficiency, altitude). Questo documento
elenca i findings **non applicati**, con la motivazione dello skip, per riferimento futuro.

---

## Fase 1 — Catalogo Phase unificato

- **`CollectionCatalogItem.code` colonna DB non rimossa.** Il campo Zod/UI è stato rimosso (nessun
  tipo catalogo residuo lo usa), ma la colonna fisica resta in `schema.prisma` (nullable, inerte).
  Drop avrebbe richiesto una nuova migration — sproporzionato per un cleanup non funzionale.

## Fase 2 — Freeze / Baseline calendario

- **`$executeRaw` per batch update in `freezeCalendar()`.** Un agente efficiency proponeva una
  singola `UPDATE ... WHERE calendarId = ...` invece di N update via `Promise.all`. Bloccato da
  regola ferma CLAUDE.md: raw SQL solo in `packages/nav/src/`. Mantenuto `Promise.all` (giudicato
  non-problema per calendari di dimensioni tipiche).
- **`updateMany` come alternativa.** Non applicabile: ogni evento riceve `baselineStartAt`/
  `baselineEndAt` diversi, `updateMany` accetta un solo payload condiviso.
- **Estrazione `describeBaselineDrift()` in helper condiviso lato `@luke/core`.** Un solo
  consumer oggi (`CalendarEventDialog.tsx`); prematuro. Lasciato `// TODO(Fase5)` che segnala il
  rischio di divergenza quando il motore alert (Fase 5) implementerà lo stesso calcolo lato server.

## Fase 3 — Aggancio/fork eventi-righe

- **Row-selector condiviso con `CreateRevisionDrawer.tsx`.** Pattern "lista righe + checkbox +
  Set selection" duplicato tra `EventAnchorDialog.tsx` e `CreateRevisionDrawer.tsx`. Skip perché
  `CreateRevisionDrawer.tsx` non era nel diff della fase — fix avrebbe richiesto toccare file fuori
  scope.
- **Riduzione query in `phaseAlert.service.ts::getApplicableEventsForRow`.** Un agente proponeva di
  collassare row→layout→calendar in una query nested `include`. Non esiste relazione diretta tra
  `CollectionLayout` e `SeasonCalendar` nello schema (join solo via `brandId+seasonId`) — richiederebbe
  una nuova relazione Prisma. La funzione non era ancora wired a nessun caller in quella fase:
  prematuro ottimizzare prima di conoscere il pattern di chiamata reale.

## Fase 4 — Storico transizioni fase

- **Convergenza `userId?: string` di `updateRow()` al pattern `ctx`-based di `logAudit`.**
  `logAudit(ctx, params)` deriva l'attore da `ctx.session` internamente; `updateRow()` riceve invece
  una stringa nuda passata dal router. Secondo pattern "recordedBy" nella codebase, ma singolo call
  site oggi — non abbastanza pressione per un refactor.
- **Helper `median()`/`percentile()` condiviso in `packages/core`.** Usato una sola volta in
  `phaseHistory.ts::layoutStats`; nessun precedente nella codebase. Prematuro finché non emerge un
  secondo consumer (es. KPI pricing/vendite).
- **Hook di scrittura storico separato da `updateRow()`.** Conflating "update riga" con "traccia
  transizione fase" in un'unica funzione è un rischio latente (un futuro path bulk/import che non
  passa da `updateRow()` salterebbe silenziosamente lo storico). Rischio solo teorico oggi: nessun
  path alternativo esiste. Documentato nel commento della funzione, non rifattorizzato.

## Fase 5 — Motore di alert

- **Unificare `getActivePhaseForRow()` e `computeSchedulingVariance()` in un `getRowPhaseContext()`
  condiviso.** Le due funzioni duplicano la risoluzione riga→fase→eventi (2×, non N×). Priorità
  bassa rispetto al fix N+1 applicato nella stessa review (quello sì bloccante, questo no).

## Fase 6 — Dashboard di monitoraggio

- **Unificare i due idiomi di aggregazione in `phaseAlert.service.ts`.** `computeSaturationHeatmap`
  usa una `Map` a chiave composita stringa, `computeBottleneckByEvent` una `Map` annidata. Non è
  inconsistenza reale: le due funzioni producono output strutturalmente diversi (piatto vs
  nested-per-evento), ognuna è la forma naturale per il proprio shape di output.
- **Waterfall `collectionLayout.get` → query dipendente in `bottleneck/page.tsx` e
  `stagnation/page.tsx`.** Una richiesta extra sequenziale per risolvere `collectionLayoutId` da
  `brandId+seasonId` prima di interrogare l'endpoint principale. Singola richiesta, non un loop —
  non urgente secondo l'agente efficiency che l'ha sollevato.
- **Hook condiviso `useCurrentLayout()` per "risolvi layout da brand+season".** Pattern duplicato
  in più pagine (`collection-layout/page.tsx`, `bottleneck/page.tsx`, `stagnation/page.tsx`), ma è
  debito pre-esistente alla Fase 6, non introdotto da questo diff — segnalato come cleanup futuro,
  non fixato in questa review.
