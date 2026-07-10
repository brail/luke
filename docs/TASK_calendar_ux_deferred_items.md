# TASK — Backlog differito: UX review calendario/collection-layout (2026-07-10)

## Istruzioni preliminari

> Leggi `CLAUDE.md` prima di qualsiasi altra cosa. Questo documento raccoglie tutto ciò che è
> stato **individuato ma deliberatamente non implementato** durante la sessione di fix
> calendario/pianificazione/alert del 2026-07-10 (14 finding, 3 fasi, tutti applicati e
> verificati — vedi commit correlati). Non duplica quel lavoro: è la lista di ciò che resta.

## Contesto

Durante l'implementazione dei 14 finding della UX review e i relativi cicli `/simplify`
(4 agenti — reuse/simplification/efficiency/altitude — per fase), alcuni miglioramenti reali
sono stati individuati ma **scartati consapevolmente** perché fuori scope, richiedevano toccare
codice non correlato, o erano generalizzazioni premature con un solo consumer attuale. Elencati
qui perché non vadano persi.

Vedi anche [`docs/TASK_working_days_calendar_relevance.md`](TASK_working_days_calendar_relevance.md)
— quello è un task pianificato a parte (feature vera, non uno skip), non ripetuto qui.

---

## 1. Click-to-filter sul banner criticità Collection Layout

**Cosa**: `CriticalityLayoutBanner.tsx` (finding #6) mostra i conteggi aggregati per banda di
criticità ma è puramente informativo — cliccare un conteggio non filtra la tabella sulle righe
corrispondenti.

**Perché skippato**: lo stato dei filtri colonna (`columnFilters`) vive **localmente in ogni
istanza di `CollectionGroupSection`** (per-gruppo, non sollevato a livello pagina) — vedi
`CollectionGroupSection.tsx`. Per rendere il banner cliccabile serve sollevare quello stato a
`page.tsx` e propagarlo a tutte le sezioni-gruppo, un refactoring reale, non un fix contenuto.

**Quando riconsiderare**: se il banner-solo-lettura si rivela insufficiente in uso reale (utenti
che continuano a scorrere la tabella manualmente invece di usarlo). File coinvolti per il
refactoring: `page.tsx`, `CollectionGroupSection.tsx`, `CollectionLayoutTable.tsx`.

## 2. Aggregazione conteggi criticità lato server

**Cosa**: `CriticalityLayoutBanner.tsx` fa il raggruppamento per banda client-side (`Map` +
`useMemo`) sui dati grezzi già in cache di `criticalityForLayout`.

**Perché skippato**: un agente di review (reuse, Fase 2) ha segnalato che lo stesso pattern di
accumulo esiste già **server-side**, due volte, in `phaseAlert.service.ts`
(`computeSaturationHeatmap`, `computeBottleneckByEvent`) e ha proposto una terza funzione
`computeCriticalitySummaryForLayout` + endpoint dedicato. Un secondo agente (altitude) ha
giudicato l'aggregazione client-side corretta per il volume di dati in gioco (righe di un solo
layout, decine non migliaia) — nessuna nuova superficie API per un banner cosmetico. Ho seguito
l'altitude verdict.

**Quando riconsiderare**: solo se il volume di righe per layout cresce di ordini di grandezza, o
se lo stesso pattern di aggregazione serve altrove (allora vale estrarre la funzione server-side
condivisa, non prima).

## 3. Rate limit dedicato per gli endpoint di lock pianificazione

**Cosa**: `editLock.acquireMany` / `renew` / `release` condividono il bucket rate-limit generico
`configMutations` (vedi `apps/api/src/routers/editLock.ts`).

**Perché skippato**: un agente efficiency (Fase 1) ha segnalato che sotto carico di molte wizard
di pianificazione aperte contemporaneamente (ognuna con heartbeat periodico), il bucket
condiviso potrebbe saturarsi per via di mutation non correlate. Non è spreco di lavoro (fuori
scope per un pass efficiency-only) — è una domanda di capacity planning.

**Quando riconsiderare**: se si osservano rate-limit hit reali sugli endpoint di lock in
produzione, o se il numero di wizard concorrenti previsto cresce sensibilmente. Fix: bucket
rate-limit dedicato (es. `editLockMutations`) in `apps/api/src/lib/ratelimit.ts`.

## 4. Hook generico per "consuma parametro URL una volta, poi rimuovilo"

**Cosa**: il deep-link `?rowId=` in `product/collection-layout/page.tsx` (finding #14) usa un
pattern locale (`useRef` guard + `useEffect` + `router.replace`) per leggere un query param una
volta, agire, e ripulire l'URL.

**Perché skippato**: un agente reuse (Fase 3) ha trovato lo **stesso pattern concettuale** già
implementato — diversamente — in `apps/web/src/app/(app)/settings/google/page.tsx:140-152`
(gestione `oauth_code`/`oauth_error` con `window.history.replaceState`). Nessuno dei due è un
helper condiviso pulito; unificarli avrebbe richiesto toccare una feature OAuth completamente
non correlata al lavoro di questa sessione — fuori scope per il diff in corso. Le due condizioni
di trigger sono anche sostanzialmente diverse (mutation-pending vs data-loaded).

**Quando riconsiderare**: se emerge un terzo consumer dello stesso pattern, vale estrarre un
hook `useConsumeSearchParam(paramName, onFound)` condiviso in `apps/web/src/hooks/`. Con due
soli consumer e semantiche di trigger diverse, l'astrazione oggi sarebbe prematura.

## 5. Hook heartbeat/lock generico

**Cosa**: la logica di heartbeat (rinnovo lock a metà TTL) è scritta interamente dentro
`useWizardLock.ts`, specifico della planning wizard — nessuna separazione tra "meccanismo di
lock generico" e "politica specifica della wizard" (frazione di rinnovo, struttura a due
timer).

**Perché skippato**: `EditLock` ha **un solo consumer** oggi (la planning wizard). Un agente
altitude (Fase 1) ha giudicato esplicitamente corretta l'altitudine attuale — estrarre un hook
generico ora sarebbe generalizzazione speculativa senza un secondo caso d'uso reale.

**Quando riconsiderare**: alla comparsa di un secondo consumer di `EditLock` (altro flusso che
necessita di un lock di sessione UI). A quel punto estrarre `useEntityLock(targets, options)`
generico da `useWizardLock.ts`, lasciando in quest'ultimo solo le scelte di policy specifiche
della wizard.

---

## 6. ~~Proposta strutturale non numerata: separare "modalità pianificazione" da "modalità manutenzione"~~ — IMPLEMENTATA (2026-07-10, stessa sessione)

**Cosa**: proposta emersa nella UX review originale (prima dei 14 finding numerati), mai
assegnata a una fase inizialmente. Oggi calendar `page.tsx` non distingue visivamente se la
stagione è "in pianificazione" (wizard/template/freeze enfatizzati) o "in manutenzione"
post-freeze (criticità/scostamenti/notifiche enfatizzati) — stesso header, stesso dropdown azioni
indipendentemente dallo stato.

**Implementazione**: `calendar/page.tsx` ora fetcha `planningGroup.list` a livello pagina, deriva
`seasonState: 'not-started' | 'planning' | 'maintenance'` da `PlanningGroup.frozenAt`/
`_count.events`, mostra un badge+tooltip accanto al titolo (vista normale e fullscreen), e
promuove il bottone "Congela pianificazione" da voce dropdown a bottone visibile in action bar
quando `seasonState === 'planning'` (rimosso dal dropdown in quel caso per evitare duplicazione).
Verificato in /simplify (agente altitude): derivazione client-side corretta, nessun secondo
consumer che giustifichi un campo server-side.
