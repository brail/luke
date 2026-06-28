# @luke/calendar

<!-- luke-docs:start:overview -->
Libreria di integrazione calendario per Luke: sincronizza le milestone stagionali con Google Calendar, genera feed iCal e risolve dipendenze tra eventi tramite un solver topologico.
<!-- luke-docs:end:overview -->

## Utilizzato da

<!-- luke-docs:start:dependents -->
- `@luke/api` (`apps/api`) — router tRPC `seasonCalendar.*`, `integrations.google.*`, job sync milestone
- `@luke/web` (`apps/web`) — tipi condivisi per il rendering del calendario milestones
<!-- luke-docs:end:dependents -->

## Export principali

<!-- luke-docs:start:exports -->
### Google Calendar

| Simbolo | Tipo | Descrizione |
|---------|------|-------------|
| `createGoogleCalendarClient` | funzione | Istanzia client Google Calendar da configurazione OAuth |
| `testGoogleConnection` | funzione | Verifica la connessione e la validità del token OAuth corrente |
| `generateOAuthUrl` | funzione | Genera URL per il flusso OAuth 2.0 |
| `exchangeOAuthCode` | funzione | Scambia il codice OAuth con access + refresh token |
| `buildCalendarSummary` | funzione | Costruisce il nome del calendario Google da metadata stagione |
| `createCalendar` / `deleteCalendar` | funzione | CRUD calendari Google |
| `addCalendarReader` / `removeCalendarReader` / `syncCalendarReaders` | funzione | Gestione ACL lettori calendario |
| `createEvent` / `updateEvent` / `deleteEvent` | funzione | CRUD eventi Google Calendar |

### Sync Engine

| Simbolo | Tipo | Descrizione |
|---------|------|-------------|
| `syncMilestone` | funzione | Sincronizza una milestone con Google Calendar (idempotente via content hash) |
| `provisionBinding` | funzione | Crea o aggiorna il binding tra milestone Luke e evento Google |
| `computeContentHash` | funzione | Hash SHA-256 del contenuto evento per rilevare drift rispetto a Google |

### iCal

| Simbolo | Tipo | Descrizione |
|---------|------|-------------|
| `generateIcal` | funzione | Genera feed iCal (`.ics`) da lista di milestone — compatibile Outlook, Apple Calendar |

### Solver dipendenze

| Simbolo | Tipo | Descrizione |
|---------|------|-------------|
| `buildGraph` | funzione | Costruisce il grafo delle dipendenze tra milestone |
| `topologicalSort` | funzione | Ordina le milestone rispettando i vincoli di dipendenza |
| `detectViolations` | funzione | Rileva violazioni (scadenze incompatibili con le dipendenze) |
| `suggestResolution` | funzione | Propone shift minimi di date per risolvere le violazioni |
| `SolverEvent` / `SolverDependency` / `Violation` / `ProposedShift` | tipo | Tipi di input/output del solver |
<!-- luke-docs:end:exports -->

## Concetti chiave

<!-- luke-docs:start:concepts -->
- **Sync idempotente**: `syncMilestone` usa `computeContentHash` per confrontare lo stato attuale dell'evento Google con i dati Luke. Scrive su Google Calendar solo se il contenuto è cambiato — zero scritture ridondanti.
- **Solver topologico**: il modulo `solver/` risolve il grafo di dipendenze `MilestoneDependency` — rileva cicli, valida ordini temporali, propone spostamenti minimi per rispettare tutti i vincoli.
- **Google OAuth 2.0**: le credenziali OAuth (client ID, secret, refresh token) sono salvate cifrate in AppConfig. Il flusso di autorizzazione è gestito via `/settings/google` nel frontend.
- **iCal per export**: `generateIcal` produce feed `.ics` standard — usato dall'endpoint `/api/ical/:token` per abbonamenti calendario esterni.
- **Nessun import da `apps/api`**: la configurazione OAuth è iniettata esternamente. Il package dipende solo da `@luke/core`, `googleapis` e `ical-generator`.
<!-- luke-docs:end:concepts -->

## Esempio d'uso

<!-- luke-docs:start:example -->
```typescript
import { createGoogleCalendarClient, syncMilestone, generateIcal, detectViolations } from '@luke/calendar';

// Istanzia client Google da config OAuth
const client = await createGoogleCalendarClient(oauthConfig);

// Sync idempotente di una milestone
await syncMilestone(client, { milestone, binding, context });

// Genera feed iCal per export/abbonamento
const icsContent = generateIcal(milestones);

// Rileva violazioni di dipendenza prima di salvare
const violations = detectViolations(buildGraph({ events: milestones, dependencies }));
```
<!-- luke-docs:end:example -->
