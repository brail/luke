# ADR-008 — AppConfig KV System and Env Policy

## Status

Superseded by [018 — Database-Backed Runtime Configuration and Bootstrap-Only Environment](018-runtime-configuration-and-bootstrap-environment.md)

## Context

The project needs to manage sensitive application configuration (SMTP credentials, LDAP bind, storage endpoints, OAuth tokens, `app.baseUrl`) securely, without exposing it in `.env` files that would end up in version control or in deploy logs.

Traditional env vars have structural problems:
- They require a rebuild or restart for every change
- They easily end up in logs, process dumps, CI exports
- They do not support native encryption
- They have no audit trail

At the same time, some variables **must** live in `.env` because of framework constraints: Prisma requires `DATABASE_URL` before the DB boots, NextAuth requires `NEXTAUTH_SECRET` at compile time, Next.js bakes `NEXT_PUBLIC_*` into the client bundle.

## Decision

A clean separation between **infrastructure bootstrap** (`.env`) and **application configuration** (AppConfig on PostgreSQL).

### `.env` allows only

**API**: `DATABASE_URL`, `PORT`, `HOST`, `NODE_ENV`, `LUKE_CORS_ALLOWED_ORIGINS`, `OTEL_*`, `LOG_LEVEL`

**Web**: `INTERNAL_API_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_FRONTEND_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `COOKIE_SECURE`

### AppConfig (PostgreSQL KV table)

Everything else lives in `AppConfig` as `key → value` pairs (string). `AppConfigRegistry` in `packages/core/src/schemas/config.ts` is the single source of truth: every key has a Zod schema, a type and a `sensitive` flag.

- Sensitive values encrypted with AES-256-GCM (master key `~/.luke/secret.key`)
- Read via `getConfigValue(prisma, key)` or the tRPC config router
- No `process.env.*` in application code

### Automatic enforcement

`assertEnvPolicy()` in `apps/api/src/server.ts` blocks boot in production if it finds forbidden patterns: `SMTP_*`, `LDAP_*`, `JWT_*`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, `*_TOKEN`.

- **Production**: `process.exit(1)` — the server does not start
- **Development**: explicit warning in the console

## Consequences

- Every new configuration key requires updating `AppConfigRegistry` with a Zod schema — config cannot be added "secretly"
- Deploys have no application secrets in container/Portainer env vars
- The audit trail of every configuration change is guaranteed by the `config.*` tRPC router
- If the DB is not reachable at boot, the application configuration is not available — the server fails fast
- `assertEnvPolicy()` must be updated if forbidden env var patterns not yet covered are added
