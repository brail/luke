import proxyAddr from '@fastify/proxy-addr';

import type { FastifyServerOptions } from 'fastify';

/**
 * fastify `trustProxy`, built from the address of the proxy that is allowed to
 * speak for a client.
 *
 * ## Why the address has to be checked
 *
 * This used to be `(_address, hop) => hop < 1` — trust whatever sits one hop
 * away, whoever it is. GHSA-3m5p-2c4r-xxw2 is exactly that shape: fastify's own
 * numeric `trustProxy: <n>` "compiles to a predicate that structurally ignores
 * the address argument", so an attacker who reaches the origin directly spoofs
 * `X-Forwarded-*` at will. **Fastify 5.12.1 fixed it** by disabling the numeric
 * form at runtime; a hand-written function with the same shape reproduces the
 * vulnerability the fix removed, which is what this module used to do. The
 * advisory's own wording: "Custom functions must inspect the `address`
 * argument, not only the hop index."
 *
 * Reproduced before this was written: with the hop-only function under 5.12.1,
 * a request from an untrusted peer carrying `X-Forwarded-For: 9.9.9.9` resolved
 * `request.ip` to `9.9.9.9`. Every `keyBy: 'ip'` bucket in `lib/ratelimit.ts`
 * is then chosen by the attacker, and `lib/auditLog.ts` records the forged
 * address as fact.
 *
 * ## The contract
 *
 * Both halves are load-bearing:
 *
 * - **hop 0 only** — the immediate peer, never an entry further down the
 *   chain. Without it a client can inject a hop whose address is itself inside
 *   the trusted range (`X-Forwarded-For: 9.9.9.9, 10.254.10.7`), walk the
 *   compiled predicate past it and have the leftmost value returned. A bare
 *   CIDR string handed to fastify has precisely that hole.
 * - **address inside the trusted range** — the peer must be the proxy we
 *   actually deployed, not merely the first thing to open a socket.
 *
 * The range arrives as `LUKE_TRUSTED_PROXY_CIDR`, which the compose files set
 * from the same interpolation that creates the `edge` network, so the subnet
 * Docker builds and the value this trusts cannot drift apart. `edge` carries
 * apps/web and apps/api and nothing else; postgres and seaweedfs sit on an
 * `internal: true` `data` network they cannot leave. That is what makes "only
 * apps/web can be hop 0" a property of the topology rather than a comment.
 *
 * Parsing and matching are `@fastify/proxy-addr`'s — the same library fastify
 * compiles `trustProxy` with — declared directly in `apps/api/package.json`
 * rather than borrowed transitively, since this module imports it by name.
 * Its `compile()` throws on anything that is not a valid address or range, so
 * a typo in the deployment fails at boot instead of silently trusting nothing.
 */
export class TrustedProxyConfigError extends Error {}

/**
 * @param cidr    Value of `LUKE_TRUSTED_PROXY_CIDR`: one address or range, or
 *                a comma-separated list. Tests pass their own.
 * @param nodeEnv `process.env.NODE_ENV`. Production without a configured range
 *                is a misconfiguration, not a default.
 */
export function createTrustProxy(
  cidr: string | undefined,
  nodeEnv: string | undefined
): FastifyServerOptions['trustProxy'] {
  const ranges = (cidr ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '');

  if (ranges.length === 0) {
    if (nodeEnv === 'production') {
      throw new TrustedProxyConfigError(
        'LUKE_TRUSTED_PROXY_CIDR is required in production. It is the range the ' +
          'reverse proxy connects from; without it apps/api cannot tell the proxy ' +
          'from any other peer on its network, and refuses to guess.'
      );
    }

    // No proxy in front of a local `pnpm dev`, so the socket address *is* the
    // client. `false` reads no X-Forwarded-* at all, which is the honest answer
    // — not a relaxed one.
    return false;
  }

  let isTrustedAddress: (address: string, hop: number) => boolean;
  try {
    isTrustedAddress = proxyAddr.compile(ranges);
  } catch (err) {
    throw new TrustedProxyConfigError(
      `LUKE_TRUSTED_PROXY_CIDR is not a valid address or range: ${ranges.join(', ')}. ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  }

  return (address, hop) => hop < 1 && isTrustedAddress(address, hop);
}
