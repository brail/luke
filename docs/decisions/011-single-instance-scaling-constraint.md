# ADR-011 — Vincolo Single-Instance e Stato Process-Local

## Status

Accepted

## Contesto

`docker-compose.prod.yml` gira un solo container `api` (nessun `deploy.replicas`, nessun load balancer davanti). Questo non è un limite temporaneo: buona parte dello stato applicativo vive in `Map`/variabili di modulo Node, condiviso implicitamente per essere nello stesso processo. Con 2+ repliche API questo stato smette di essere condiviso — ogni istanza vede solo la propria metà, silenziosamente.

Inventario dello stato process-local (non esaustivo, ma copre tutto ciò che romperebbe con N>1):

| Stato | File | Rottura con N>1 |
|---|---|---|
| Rate limit store | `apps/api/src/lib/ratelimit.ts` | Limite effettivo diventa N× quello configurato (ogni istanza conta per conto suo) |
| Idempotency cache | `apps/api/src/lib/idempotency.ts` | Un retry instradato su un'altra istanza causa doppia esecuzione |
| SSE connections + ticket | `apps/api/src/lib/sseStore.ts` | Il caso peggiore: un evento emesso dall'istanza A non raggiunge un client SSE connesso all'istanza B |
| tokenVersion cache (ADR-009) | `apps/api/src/lib/tokenVersionCache.ts` | Force-logout non propaga alle altre istanze fino a scadenza TTL locale |
| RBAC config cache | `packages/core/src/server/rbacConfig.ts` | `invalidateRbacCache()` invalida solo la cache locale; le altre istanze servono permessi stale |
| Presence store | `apps/api/src/lib/presenceStore.ts` | Vista "utenti online" parziale, dipende su quale istanza è atterrato l'ultimo heartbeat |
| Buffer notifiche calendario | `apps/api/src/lib/notifications.ts` (`calendarBuffer`, `dedupLastSentAt`) | Dedup salta a metà: notifiche duplicate se lo stesso evento tocca istanze diverse |

Sono già scale-out-safe (persistiti su Postgres, non in memoria): `EditLock` (ADR — vedi `packages/db/prisma/schema.prisma`), sessioni NextAuth (`strategy: 'jwt'`, stateless per design).

Separato ma correlato: 7 scheduler tick-based (`backupScheduler`, `calendarDigestScheduler`, `kimoSyncScheduler`, `maintenanceModeScheduler`, `milestoneDeadlineScheduler`, `navSyncScheduler`, `portafoglioSyncScheduler`) avevano solo un guard `isRunning` in-memory: sufficiente a prevenire la doppia esecuzione nello stesso processo, ma con 2 istanze avrebbe permesso due backup, due sync NAV, due digest email concorrenti sugli stessi dati.

## Decisione

**L'API è single-instance by design.** Non introduciamo infrastruttura di coordinamento cross-processo (Redis o simile) per scalare orizzontalmente finché non c'è un motivo concreto misurato (vedi trigger sotto) — il costo (nuovo servizio, nuovo failure mode, doppio code path dev/prod, gestione password fuori dalla Env Policy) non è giustificato dal carico attuale (decine di utenti interni).

**Eccezione già corretta**: il rischio di doppia esecuzione concorrente sugli scheduler è stato chiuso comunque, perché è un bug latente indipendente dallo scaling (basta un `replicas: 2` distratto in Portainer per innescarlo) — vedi `apps/api/src/lib/schedulerLock.ts` (`withSchedulerLock`). Lock a riga DB (tabella `SchedulerLock`, stesso idioma di `EditLock`: `expiresAt` come rete di sicurezza per crash, rilascio esplicito nel path normale) — non un vero requisito di scaling, quindi non contraddice la decisione sopra.

Tutto il resto in tabella resta **esplicitamente non gestito**: se qualcuno imposta più repliche API senza prima affrontare questo ADR, il comportamento sarà degradato in modi silenziosi (non un crash), elencati sopra.

## Conseguenze

- **Vietato** impostare `replicas > 1` per il servizio `api` in `docker-compose.prod.yml`/Portainer senza prima risolvere l'inventario sopra (minimo: SSE e rate-limit, i due più visibili all'utente)
- Scaling verticale (più CPU/RAM sullo stesso container) resta pienamente supportato e non richiede nessuna modifica
- Se in futuro si introduce Redis (o equivalente) per lo scaling, gli scheduler in `apps/api/src/lib/schedulerLock.ts` NON vanno migrati per forza — il lock a riga DB resta valido e più semplice; Redis servirebbe solo per SSE/rate-limit/idempotency/presence
- Revisionare questo ADR prima di ogni decisione infrastrutturale che tocchi `replicas`, load balancer, o sticky sessions

### Trigger concreti per rivedere questa decisione

Prima che uno di questi sia vero e misurato (non ipotizzato), non introdurre Redis:

1. Serve HA / zero-downtime deploy → repliche API multiple
2. CPU del container singolo saturo, misurato sotto carico reale
3. Serve una job queue vera (retry/backoff/dead-letter/observability) — oggi gli scheduler sono fire-and-forget con log-and-continue
4. Node in cluster mode (multi-worker) sulla stessa VM
