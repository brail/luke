# Decisions in force — Platform

> Current guidance, kept up to date; not a decision record. The ADRs linked here decide: where this page and an Accepted ADR disagree, the ADR holds.

_Last reviewed: 2026-11-22_

## Rules in force

- `@luke/core` is ESM-only (`"type": "module"`) and publishes exactly two subpaths, `.` and `./server`; `./utils/date` is retired with `utils/date.ts`, and its formatters are not carried forward under another name. [ADR-037](../037-core-package-export-boundary-two-subpaths.md), [ADR-022](../022-core-package-export-boundary.md)
- `packages/core/test/module-contract.cjs` pins the two subpaths and that `@luke/core/utils/date` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`; it is narrow on purpose and does not inspect what a client bundle contains. [ADR-037](../037-core-package-export-boundary-two-subpaths.md), [ADR-022](../022-core-package-export-boundary.md)
- The core build is a single `rm -rf dist && tsc` whose `dist/` mirrors `src/`; `dist/crypto/secrets.server.js` is not a subpath, because no `exports` entry names it. [ADR-022](../022-core-package-export-boundary.md)
- `@luke/core/server` is a barrel re-exporting `./rbacConfig.js` and `../crypto/secrets.server.js`. [ADR-022](../022-core-package-export-boundary.md)
- The `exports` map blocks only unpublished paths, such as a deep import of `secrets.server`, and does not restrict the published `@luke/core/server`. [ADR-022](../022-core-package-export-boundary.md)
- `@luke/no-restricted-module-references` is what keeps `@luke/core/server` out of web files, judging the specifier with no resolution or build, and `WEB_SERVER_ENTRYPOINT_IMPORTERS` (today `apps/web/src/auth.ts` alone) is its allowlist, where enrolling a file is the decision point. [ADR-022](../022-core-package-export-boundary.md)
- `secrets.server.ts` throws when `typeof window !== 'undefined'`, only when the module is evaluated; `rbacConfig.ts` has no such guard, so `@luke/core/server` throws only through the barrel's side effect and the throw is a diagnostic, not containment. [ADR-022](../022-core-package-export-boundary.md)
- Core's TypeScript configuration does not enforce the client/server split: `packages/core/tsconfig.json` keeps `DOM` in `lib` and `types: ["node"]` package-wide, and leaves the split to the ESLint globals configuration. [ADR-022](../022-core-package-export-boundary.md)
- No test asserts the runtime throw of `secrets.server.ts`, and nothing asserts that a built client bundle excludes server code; both are open gaps. [ADR-037](../037-core-package-export-boundary-two-subpaths.md)
- A schema shared by apps/api and apps/web lives in `packages/core/src/schemas/` and both import the same object; the catalogue is deliberately not exhaustive, and a schema used by a single endpoint, such as a list filter, stays where it is. [ADR-024](../024-shared-schemas-and-message-audience.md#errata)
- A schema moves to core when the web rewrites the same rule by hand; a schema reused by more than one endpoint deserves a name even if the web does not touch it. [ADR-024](../024-shared-schemas-and-message-audience.md#errata)
- A validation message's language is decided by its audience, not by its file: a message that reaches `FormMessage` through `zodResolver`, or a `BAD_REQUEST` the web shows through `apps/web/src/lib/trpcErrorMessages.ts`, is product UI and stays as it is until the i18n cycle. [ADR-024](../024-shared-schemas-and-message-audience.md)
- No non-UI exception for schema messages is established: before a message's language changes it is traced to every consumer, one with a form or `BAD_REQUEST` path stays put, and enforcement for source and schema messages is review. [ADR-024](../024-shared-schemas-and-message-audience.md#errata)
- A new schema follows the export casing of the module it joins; neither PascalCase nor camelCase `*Schema` names are imposed. [ADR-024](../024-shared-schemas-and-message-audience.md)
- apps/api is single-instance by design: no Redis or other cross-process coordination is introduced until a trigger is true and measured — HA or zero-downtime deploys needing replicas, the container's CPU saturated under real load, a real job queue, or Node in cluster mode. [ADR-011](../011-single-instance-scaling-constraint.md)
- Setting `replicas > 1` for the `api` service in `docker-compose.prod.yml` or Portainer is forbidden before the process-local state is resolved, SSE and rate limiting at least; vertical scaling needs no change. [ADR-011](../011-single-instance-scaling-constraint.md)
- The process-local state that breaks with more than one instance includes the rate-limit store, the idempotency cache, SSE connections and tickets, the tokenVersion cache, the RBAC config cache, the presence store, the calendar notification buffer (`calendarBuffer`), the pending Google OAuth flows (`pendingOAuthStates`) and the guards against a second restore and a second migration bridge of the same backup (`running` in `maintenance.backup.router.ts`). [ADR-011](../011-single-instance-scaling-constraint.md#errata)
- The tick-based schedulers take `withSchedulerLock` (`apps/api/src/lib/schedulerLock.ts`), a `SchedulerLock` row with `expiresAt` as the crash safety net and explicit release on the normal path, which stays valid if Redis is ever introduced. [ADR-011](../011-single-instance-scaling-constraint.md)
- Already safe to scale out: `EditLock` and `SchedulerLock` (`packages/db/prisma/platform.prisma`), notification dedup in `NotificationDedupKey`, and NextAuth's stateless `jwt` sessions. [ADR-011](../011-single-instance-scaling-constraint.md#errata)
- The schedulers are fire-and-forget with log-and-continue, except the calendar digest, whose `CalendarDigestDelivery` record (a lease, at most three attempts with a backoff, a logged terminal `ABANDONED`) is a delivery record for that job, not a job queue. [ADR-011](../011-single-instance-scaling-constraint.md#errata)
- ADR-011 is reviewed before any infrastructure decision that touches `replicas`, load balancers or sticky sessions. [ADR-011](../011-single-instance-scaling-constraint.md)

## Records

| ADR | Role |
| --- | --- |
| [037](../037-core-package-export-boundary-two-subpaths.md) | in force |
| [024](../024-shared-schemas-and-message-audience.md) ([errata](../024-shared-schemas-and-message-audience.md#errata)) | in force |
| [011](../011-single-instance-scaling-constraint.md) ([errata](../011-single-instance-scaling-constraint.md#errata)) | in force |
| [022](../022-core-package-export-boundary.md) | carried by 037 |
