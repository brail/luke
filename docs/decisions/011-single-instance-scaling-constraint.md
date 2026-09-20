# ADR-011 — Single-Instance Constraint and Process-Local State

## Status

Accepted

## Context

`docker-compose.prod.yml` runs a single `api` container (no `deploy.replicas`, no load balancer in front). This is not a temporary limit: much of the application state lives in `Map`s/Node module variables, shared implicitly by virtue of being in the same process. With 2+ API replicas that state stops being shared — each instance sees only its own half, silently.

Inventory of the process-local state (not exhaustive, but it covers everything that would break with N>1):

| State | File | Breakage with N>1 |
|---|---|---|
| Rate limit store | `apps/api/src/lib/ratelimit.ts` | The effective limit becomes N× the configured one (each instance counts on its own) |
| Idempotency cache | `apps/api/src/lib/idempotency.ts` | A retry routed to another instance causes double execution |
| SSE connections + ticket | `apps/api/src/lib/sseStore.ts` | The worst case: an event emitted by instance A does not reach an SSE client connected to instance B |
| tokenVersion cache (ADR-009) | `apps/api/src/lib/tokenVersionCache.ts` | Force-logout does not propagate to the other instances until the local TTL expires |
| RBAC config cache | `packages/core/src/server/rbacConfig.ts` | `invalidateRbacCache()` invalidates only the local cache; the other instances serve stale permissions |
| Presence store | `apps/api/src/lib/presenceStore.ts` | Partial "online users" view, depending on which instance the last heartbeat landed on |
| Calendar notification buffer | `apps/api/src/lib/notifications.ts` (`calendarBuffer`, `dedupLastSentAt`) | Dedup breaks halfway: duplicate notifications if the same event touches different instances |

Already scale-out-safe (persisted in Postgres, not in memory): `EditLock` (ADR — see `packages/db/prisma/schema.prisma`), NextAuth sessions (`strategy: 'jwt'`, stateless by design).

Separate but related: 7 tick-based schedulers (`backupScheduler`, `calendarDigestScheduler`, `kimoSyncScheduler`, `maintenanceModeScheduler`, `milestoneDeadlineScheduler`, `navSyncScheduler`, `portafoglioSyncScheduler`) had only an in-memory `isRunning` guard: enough to prevent double execution within the same process, but with 2 instances it would have allowed two backups, two NAV syncs, two email digests running concurrently on the same data.

## Decision

**The API is single-instance by design.** We do not introduce cross-process coordination infrastructure (Redis or similar) to scale horizontally until there is a concrete, measured reason (see the triggers below) — the cost (a new service, a new failure mode, a double dev/prod code path, password management outside the Env Policy) is not justified by the current load (tens of internal users).

**Exception already fixed**: the risk of concurrent double execution on the schedulers was closed anyway, because it is a latent bug independent of scaling (one distracted `replicas: 2` in Portainer is enough to trigger it) — see `apps/api/src/lib/schedulerLock.ts` (`withSchedulerLock`). A DB-row lock (table `SchedulerLock`, same idiom as `EditLock`: `expiresAt` as a safety net for crashes, explicit release on the normal path) — not a real scaling requirement, so it does not contradict the decision above.

Everything else in the table remains **explicitly unhandled**: if someone sets more API replicas without first addressing this ADR, the behaviour will be degraded in silent ways (not a crash), listed above.

## Consequences

- **Forbidden** to set `replicas > 1` for the `api` service in `docker-compose.prod.yml`/Portainer without first resolving the inventory above (at minimum: SSE and rate limiting, the two most visible to the user)
- Vertical scaling (more CPU/RAM on the same container) remains fully supported and requires no change
- If Redis (or an equivalent) is introduced for scaling in the future, the schedulers in `apps/api/src/lib/schedulerLock.ts` do NOT have to be migrated — the DB-row lock remains valid and simpler; Redis would be needed only for SSE/rate limiting/idempotency/presence
- Review this ADR before every infrastructure decision that touches `replicas`, load balancers, or sticky sessions

### Concrete triggers for revisiting this decision

Until one of these is true and measured (not hypothesised), do not introduce Redis:

1. HA / zero-downtime deploy is needed → multiple API replicas
2. The single container's CPU is saturated, measured under real load
3. A real job queue is needed (retry/backoff/dead-letter/observability) — today the schedulers are fire-and-forget with log-and-continue
4. Node in cluster mode (multi-worker) on the same VM
