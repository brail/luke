# apps/web — Frontend Luke

<!-- luke-docs:start:overview -->
Luke's web interface: Next.js with the App Router, shadcn/ui components on Tailwind CSS, and NextAuth sessions. It renders the whole management platform — collection plan, pricing, seasonal calendar, sales statistics, administration and maintenance — behind section-level RBAC, with light/dark theming and a Playwright end-to-end suite. Every backend call goes through tRPC with types imported from `@luke/api`; in a containerized deployment the browser reaches only Next.js, which forwards `/trpc`, `/upload`, `/download` and the SSE endpoints to `apps/api` through the rewrites in `next.config.js`.
<!-- luke-docs:end:overview -->

## Route principali

<!-- luke-docs:start:routes -->
Entry point:

- `/` — server component that redirects to `/dashboard` when a session exists, to `/login` otherwise

Authenticated group `(app)/`:

- `/dashboard` — per-user configurable widgets (KPI stats, season progress, clocks, forex, weekly sales, personal tasks)
- `/about` — application information: technology stack and running version
- `/admin/brands` — brand management
- `/admin/seasons` — season management
- `/admin/vendors` — internal vendor registry
- `/admin/calendar-configuration` — seasonal milestone calendar templates and template items
- `/admin/collection-layout-configuration` — collection catalog: configurable options for the collection layout
- `/admin/phase-catalog` — unified phase catalog, the production/calendar phase ordering shared by collection layout and calendar
- `/calendar` — seasonal calendar with month, Gantt, week, day and list views, planning-group freeze and Google Calendar sync
- `/product/collection-layout` — collection plan (groups and rows, quotations, drag-and-drop ordering)
- `/product/collection-layout/revisions` — revision history, ISO 9001:2015 quality record
- `/product/collection-layout/revisions/[revisionId]` — a single immutable revision snapshot
- `/product/control` — phase planning and collection layout statistics
- `/product/merchandising-plan` — merchandising plan with specsheets and images
- `/product/pricing` — costs and prices engine (forward / inverse / margin)
- `/sales/statistics` — order portfolio statistics and KIMO sales extraction, served from the NAV replica
- `/settings/users` — user and role management, pending access requests
- `/settings/mail` — SMTP configuration with test email
- `/settings/ldap` — LDAP authentication with connection test
- `/settings/storage` — storage provider (local filesystem / S3)
- `/settings/nav` — Microsoft NAV SQL Server connection
- `/settings/nav-sync` — NAV synchronization scheduling for master data, order portfolio and KIMO, with sync logs
- `/settings/google` — Google Workspace integration (service account or OAuth 2.0) and per-product toggles
- `/settings/company` — company profile and organizational structure
- `/settings/collection-control` — calendar and phase alert thresholds
- `/maintenance` — maintenance and diagnostics index
- `/maintenance/config` — AppConfig keys, the centralized runtime configuration
- `/maintenance/audit-log` — audit trail browsing and export
- `/maintenance/backup` — encrypted database backup and restore
- `/maintenance/mode` — maintenance mode (write lock, user banner)
- `/maintenance/import-export` — data import/export in JSON, CSV or XLSX
- `/profile` — user profile, preferences and security settings
- `/notifications` — full notification history

Public group `(public)/`:

- `/login` — login page (local / LDAP)
- `/auth/reset` — password reset through an emailed token
- `/auth/verify` — email address verification
- `/auth/pending` — waiting screen after verification

Route handlers `api/`:

- `/api/auth/[...nextauth]` — NextAuth handler
- `/api/auth/force-logout` — server-side session teardown for a stale or revoked cookie, then redirect to `/login`
- `/api/google/oauth/callback` — Google OAuth 2.0 callback
- `/api/uploads/[...path]` — authenticated proxy that streams stored files from the API, with per-segment path validation

Every other API path (`/trpc`, `/upload`, `/download`, `/api/sse`, `/health`) is proxied to `apps/api` by the rewrites in `next.config.js`, which are active only when `INTERNAL_API_URL` is set.
<!-- luke-docs:end:routes -->

## Dipendenze interne

<!-- luke-docs:start:internal-deps -->
- `@luke/core` — runtime dependency: Zod schemas, shared types, RBAC helpers, URL builders and storage contracts. Listed in `transpilePackages` in `next.config.js`
- `@luke/api` — type-only devDependency: `AppRouter` plus the inferred `RouterOutputs` / `RouterInputs` types that give the tRPC client end-to-end typing. Resolved through the package's `exports` map to its emitted declarations, so nothing from it is bundled at runtime
<!-- luke-docs:end:internal-deps -->

## Variabili d'ambiente

<!-- luke-docs:start:env -->
| Variable | Description | Required |
|----------|-------------|----------|
| `INTERNAL_API_URL` | API base URL on the internal network (e.g. `http://api:3001`). Enables the `next.config.js` rewrites and is the base SSR and middleware call directly; unset in local development, where the rewrites are skipped | In containers |
| `NEXT_PUBLIC_API_URL` | Public API URL, inlined into the client bundle at build time; falls back to `http://localhost:3001` | For production builds |
| `NEXT_PUBLIC_FRONTEND_URL` | Public frontend URL used to build outbound links, such as the base URL sent with the SMTP test email; when unset, that test email is sent with an empty base URL | No |
| `NEXTAUTH_URL` | Canonical frontend URL used by NextAuth for callbacks | In containers |
| `NEXTAUTH_SECRET` | NextAuth signing secret. `src/auth.ts` refuses to start in production without it; in development it is derived from the master key `~/.luke/secret.key` | In production |
| `COOKIE_SECURE` | In production, set to `false` when serving plain HTTP; any other value keeps the session cookie `Secure`. Outside production the cookie is never `Secure` | No |
| `NEXT_PUBLIC_APP_VERSION` | Build-time version metadata injected from the git tag; absent under `pnpm dev`, where the UI shows a development marker instead | No |

Everything else — SMTP, LDAP, storage, NAV, Google — lives in AppConfig in the database, never in environment variables.
<!-- luke-docs:end:env -->

## Sviluppo locale

<!-- luke-docs:start:dev -->
```bash
# From the monorepo root — starts every workspace through Turbo
pnpm dev

# Frontend only
pnpm --filter @luke/web dev
```

The frontend serves `http://localhost:3000` and expects the API on `http://localhost:3001`.

Tests:

```bash
pnpm --filter @luke/web test          # Vitest unit tests
pnpm --filter @luke/web test:browser  # component tests in a real browser
pnpm --filter @luke/web test:e2e      # Playwright smoke suite
```
<!-- luke-docs:end:dev -->

## Client data refresh after mutations

tRPC mutations go through `useStandardMutation`
([`src/lib/useStandardMutation.ts`](src/lib/useStandardMutation.ts)), which runs
the mutation, shows the success or error toast and invalidates the affected
React Query caches through a named helper from `useRefresh()`
([`src/lib/refresh.ts`](src/lib/refresh.ts)):

```typescript
const refresh = useRefresh();
const saveConfigMutation = trpc.storage.saveConfig.useMutation();

const { mutate: saveConfig, isPending } = useStandardMutation({
  mutateFn: saveConfigMutation.mutateAsync,
  invalidate: refresh.storageConfig,
  onSuccessMessage: '…', // product UI text
  onErrorMessage: '…',
});
```

`onSuccess` and `onError` callbacks are available for logic that goes beyond the
toast, such as closing a dialog or navigating.

`useRefresh()` provides four helpers:

| Helper | Invalidates |
|---|---|
| `me` | the current user's profile |
| `users` | the active and pending user lists |
| `storageConfig` | the storage configuration |
| `company` | the company functions and teams |

Prefer these helpers to manual `refetch()` calls and to ad-hoc `onSuccess`
invalidations. The React Query client in [`src/lib/trpc.tsx`](src/lib/trpc.tsx)
sets queries to a 60-second `staleTime`, one retry and no refetch on window
focus, and mutations to no retry, so a failed mutation is never resubmitted
automatically.
