# ADR-046 — Web Server Refuses TLS Verification Switched Off

## Status

Accepted

## Context

[ADR-045](045-bootstrap-guard-refuses-tls-verification-switched-off.md) made apps/api refuse a
production start when `NODE_TLS_REJECT_UNAUTHORIZED` is `0`. The apps/web Node.js server reads the
same variable, and it ran no start check (ADR-018). Its server-side fetches go to apps/api over HTTP
today (`buildTrpcUrl`, `buildApiUrl`; NextAuth uses only the Credentials provider, backed by
`auth.login`), so no TLS connection depends on it yet; any HTTPS call added later would skip
certificate verification. Owner decision #103 a covers both processes (#283).

apps/web has no start sequence of its own: the image runs Next's standalone `server.js`. Next 16
calls `register()` in `src/instrumentation.ts` once per server start. In production it does so right
after the server starts listening, without awaiting it, and a rejected `register()` is logged while
the server keeps running (`next/dist/server/next-server.js`).

## Decision

- **The same rule, one implementation.** `tlsVerificationOffProblem` in `@luke/core`
  (`packages/core/src/runtime/tlsVerification.ts`) holds the `=== '0'` check and the message; apps/api's
  `assertEnvPolicy` and apps/web's `register()` both call it. It is in the main entry, not
  `@luke/core/server`, because it needs no master key and reads only the environment it is given.
- **apps/web refuses in `register()`.** In the Node.js runtime, in production, it writes
  `[env-policy] …` to the console and calls `process.exit(1)`: a throw would not stop the server.
  Outside production it warns through `debugWarn`. Outside the Node.js runtime it does nothing.
  "Production" is `isProduction()`, as in `auth.ts`; Next fixes `NODE_ENV` when the image is built, so
  a production image always refuses, where apps/api reads `NODE_ENV` at start.
- **The name denylist stays apps/api's.** apps/web legitimately carries `NEXTAUTH_*`.
- **The start window is accepted** (owner, 2026-11-22), over a check preloaded by the image's `CMD`
  before the server listens. Between `listen` and the exit, Next can already answer static files and
  the rewrites to apps/api; rendering, route handlers and NextAuth wait for `register()` and never run.
  Neither of the two opens a TLS connection: static files open none, and the rewrites target apps/api
  over HTTP inside the Docker network (`INTERNAL_API_URL`, baked at build time). Today the server
  opens no TLS connection anywhere.

## Consequences

- A production web container with the variable set to `0` exits 1 at every start, as apps/api does.
- **Revisit the preload** when a rewrite targets an `https` destination, or a `middleware.ts` or
  `proxy.ts` makes outbound calls: either would open a TLS connection inside the start window.
- The console line is the only production log the web server writes by itself; `debugError` is silent
  there (rule 10's exception, a reasoned `nosemgrep`).
- `apps/web/src/instrumentation.test.ts` covers the hook; the CI `images` job starts the web image
  with the variable set and accepts only exit 1 with the message.
