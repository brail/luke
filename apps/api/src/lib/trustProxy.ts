import type { FastifyServerOptions } from 'fastify';

/**
 * fastify `trustProxy` option, extracted so `server.ts` and
 * `test/ratelimit.integration.spec.ts` (which asserts the spoofed-hop
 * behavior below) share one definition instead of risking drift.
 *
 * apps/api is never directly reachable from the Internet (no port published
 * in docker-compose.prod.yml/rc.yml): the only entry point is the apps/web
 * container, either via next.config.js rewrites or via NextAuth's
 * server-to-server fetch (apps/web/src/auth.ts). Trusting X-Forwarded-For
 * here is therefore safe and necessary so that req.ip resolves to the real
 * client IP instead of the web container's internal address (root cause of
 * the shared rate-limit bucket on /trpc/auth.login).
 *
 * Trust exactly one hop (the apps/web container, the only possible sender).
 * `true` trusts an unlimited chain and resolves req.ip to the leftmost
 * entry — i.e. the value a client can self-declare — making every
 * keyBy:'ip' rate-limit bucket bypassable by sending a fake X-Forwarded-For
 * (CRITICAL, audit 2026-08-07). With hop `0` trusted, apps/api trusts only
 * the direct socket (always apps/web) and reads the entry immediately
 * before it — the one NPM itself appended via $proxy_add_x_forwarded_for,
 * never the one self-declared by the client.
 *
 * Expressed as a function, not the `1` shorthand: fastify 5.12's numeric
 * trustProxy handling regressed to always resolve to untrusted (fails
 * closed silently — checked against fastify's own source,
 * lib/request.js:getTrustProxyFn). This function reproduces the exact same
 * hop-count semantics fastify's own numeric handling used to have.
 */
export const trustProxy: FastifyServerOptions['trustProxy'] = (_address, hop) => hop < 1;
