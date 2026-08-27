/**
 * Guards the invariant that every raw (non-tRPC) Fastify route the browser calls is actually
 * reachable in production.
 *
 * In production the browser can only reach Next.js — apps/api publishes no port
 * (docker-compose.prod.yml) — so a raw route is reachable only if `apps/web/next.config.js`
 * rewrites its path to the API container. A path with no rewrite does not fail loudly: it falls
 * through to Next's own routing and comes back as the 404 page. A `fetch` caller at least sees
 * `res.ok === false`; an `<a download>` caller silently saves that HTML under the requested
 * filename. That is how backup downloads shipped 24KB of Next 404 page in place of a 4 MB backup.
 *
 * Rather than diff two lists of paths (which drift), the invariant is a naming rule: browser-facing
 * raw routes live under `/download/` (streamed GET responses) or `/upload/` (streamed POST bodies),
 * and next.config.js wildcards exactly those two prefixes. This test enforces both halves.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const API_SRC = join(import.meta.dirname, '..', 'src');
const NEXT_CONFIG = join(import.meta.dirname, '..', '..', 'web', 'next.config.js');

/** The two prefixes next.config.js proxies wholesale. Any browser-facing raw route must use one. */
const PROXIED_PREFIXES = ['/download/', '/upload/'] as const;

/**
 * Raw routes that are NOT called by a browser, and so need no rewrite.
 *
 * Deliberately short and justified one by one: adding a browser-facing path here re-opens the
 * exact bug this test exists to catch, so each entry has to state why no browser ever requests it.
 */
const NOT_BROWSER_FACING = [
  '/',            // API root banner
  '/health',      // probes below: hit by Docker/Portainer healthchecks and the reverse proxy
  '/api/health',
  '/healthz',
  '/livez',
  '/readyz',
  '/api/sse',     // SSE — has its own dedicated rewrite (not a wildcard prefix)
  '/__test__/boom', // registered only when NODE_ENV=test, to exercise the error handler
  '/uploads/:bucket/*', // authenticated asset proxy — reached through Next's app/api/uploads route handler
  // The two /storage/* routes below are handed to the browser as absolute URLs built from
  // AppConfig (`storage.publicBaseUrl`, falling back to `app.baseUrl`) rather than from
  // NEXT_PUBLIC_API_URL, so a next.config.js rewrite is not what makes them reachable and this
  // test cannot judge them. Whether that configured base actually resolves is a separate,
  // deployment-level question — see docs, not this list.
  '/storage/download',
  '/storage/upload/:uploadId',
] as const;

type ExemptPath = (typeof NOT_BROWSER_FACING)[number];

function isExempt(path: string): path is ExemptPath {
  return (NOT_BROWSER_FACING as readonly string[]).includes(path);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full);
    return full.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(full) ? [full] : [];
  });
}

/** Matches `fastify.get('/x')`, `app.post<{...}>('/x')`, and the same split across lines. */
const ROUTE_RE = /\.(get|post|put|patch|delete|all)\s*(?:<[\s\S]*?>)?\s*\(\s*'([^']+)'/g;

function collectRawRoutes(): { path: string; file: string }[] {
  const found: { path: string; file: string }[] = [];
  for (const file of walk(API_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(ROUTE_RE)) {
      const path = match[2];
      if (path.startsWith('/')) found.push({ path, file });
    }
  }
  return found;
}

describe('raw route proxying', () => {
  const routes = collectRawRoutes();

  it('finds the raw routes at all (guards the scanner itself against silently matching nothing)', () => {
    expect(routes.length).toBeGreaterThan(5);
    expect(routes.map(r => r.path)).toContain('/download/backup/:id');
  });

  it('registers every browser-facing raw route under a proxied prefix', () => {
    const unreachable = routes
      .filter(r => !isExempt(r.path))
      .filter(r => !PROXIED_PREFIXES.some(prefix => r.path.startsWith(prefix)));

    expect(
      unreachable.map(r => `${r.path}  (${r.file.slice(r.file.indexOf('apps/'))})`),
      'These raw routes have no rewrite in apps/web/next.config.js, so in production they resolve ' +
        'to the Next.js 404 page instead of the API. Move them under /download/ or /upload/, or — ' +
        'only if no browser ever calls them — add them to NOT_BROWSER_FACING with a reason.'
    ).toEqual([]);
  });

  it('keeps a wildcard rewrite in next.config.js for each proxied prefix', () => {
    const config = readFileSync(NEXT_CONFIG, 'utf8');
    for (const prefix of PROXIED_PREFIXES) {
      expect(config, `next.config.js must rewrite ${prefix}:path*`).toContain(`source: '${prefix}:path*'`);
    }
  });
});
