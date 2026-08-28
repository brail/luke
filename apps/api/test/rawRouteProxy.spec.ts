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
 *
 * It also checks the other side of the contract: that the paths callers actually request exist.
 * Renaming these routes once left `scripts/rc-prod-clone.ts` posting to a path that had moved,
 * while the documentation for that very script was updated in the same change — a caller reaching
 * a route that no longer exists gets a 404 from Next, not a build error, so nothing surfaced it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
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

function walk(dir: string, extensions: string[] = ['.ts']): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : walk(full, extensions);
    const wanted = extensions.some(ext => full.endsWith(ext));
    return wanted && !/\.(test|spec)\.tsx?$/.test(full) ? [full] : [];
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


const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/**
 * Where raw API paths are requested from. Deliberately not apps/web's pages: a Next.js page route
 * shares the `/maintenance/...` shape with the old API paths, and telling them apart statically
 * is not worth the false positives. What is scanned instead are the two forms that unambiguously
 * address the API — `buildApiUrl('...')`, and a template literal opening with a `…Url`/`…url`
 * interpolation, which is how the scripts build absolute API URLs.
 */
const CALLER_DIRS = ['apps/web/src', 'packages/core/src', 'scripts'];

/** `buildApiUrl('/x')` — unambiguously an API path, wherever it appears. */
const BUILD_API_URL_RE = /buildApiUrl\(\s*[`'"]([^`'"]+)[`'"]/g;
/**
 * A template literal opening with a `…Url` interpolation, scanned only under `scripts/`.
 * That is how the scripts address a deployed instance (`${prodUrl}/download/...`). The same shape
 * in apps/web is usually a frontend redirect (`${baseUrl}/dashboard`), so scanning it there would
 * report pages as missing API routes.
 */
const BASE_URL_TEMPLATE_RE = /`\$\{[A-Za-z_$][\w$]*[Uu]rl\}(\/[^`]*)`/g;

/** Strips block comments, so a `@example buildApiUrl('/x')` in a docstring is not read as a call. */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Splits a path into segments, dropping any query string; `:id`, `${expr}` and `*` all become `*`. */
function segmentsOf(path: string): string[] {
  return path
    .split('?')[0]
    .replace(/\$\{[^}]*\}/g, '*')
    .replace(/:[A-Za-z_][\w]*/g, '*')
    .split('/')
    .filter(Boolean);
}

/**
 * Whether a route can serve a requested path. `*` matches one segment on either side: a route's
 * `:specsheetId` accepts the literal `temp`, and a caller's `${format}` may land on any of the
 * literal `ical` / `pdf` / `xlsx` routes. A trailing `*` in a route (Fastify's wildcard) matches
 * the rest.
 */
function routeServes(routeSegments: string[], requestedSegments: string[]): boolean {
  if (routeSegments.at(-1) === '*' && requestedSegments.length >= routeSegments.length - 1) {
    return routeSegments
      .slice(0, -1)
      .every((seg, i) => seg === '*' || seg === requestedSegments[i]);
  }
  if (routeSegments.length !== requestedSegments.length) return false;
  return routeSegments.every((seg, i) => seg === '*' || requestedSegments[i] === '*' || seg === requestedSegments[i]);
}

function collectRequestedPaths(): { path: string; file: string }[] {
  const requested: { path: string; file: string }[] = [];
  for (const dir of CALLER_DIRS) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const file of walk(root, ['.ts', '.tsx'])) {
      const source = stripBlockComments(readFileSync(file, 'utf8'));
      const patterns = dir === 'scripts' ? [BUILD_API_URL_RE, BASE_URL_TEMPLATE_RE] : [BUILD_API_URL_RE];
      for (const re of patterns) {
        for (const match of source.matchAll(re)) {
          if (match[1].startsWith('/')) requested.push({ path: match[1], file });
        }
      }
    }
  }
  return requested;
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

  it('only requests raw API paths that a route actually serves', () => {
    const served = routes.map(r => segmentsOf(r.path));
    // Handled by Next itself rather than by a Fastify route: tRPC, NextAuth, and the asset proxy.
    const handledByNext = [/^\/trpc\b/, /^\/api\b/, /^\/uploads\b/];

    const requested = collectRequestedPaths();
    expect(requested.length, 'the caller scanner matched nothing').toBeGreaterThan(3);

    const dangling = requested
      .filter(r => !handledByNext.some(re => re.test(r.path)))
      .filter(r => !served.some(route => routeServes(route, segmentsOf(r.path))))
      .map(r => `${r.path}  (${r.file.replace(REPO_ROOT + '/', '')})`);

    expect(
      dangling,
      'These callers request a raw API path no route serves. In production the request reaches ' +
        'Next.js and comes back as its 404 page, which a fetch caller reports as a failed request ' +
        'and a download caller saves to disk — neither is a build error, so a renamed route takes ' +
        'its callers down silently.'
    ).toEqual([]);
  });

  it('keeps a wildcard rewrite in next.config.js for each proxied prefix', () => {
    const config = readFileSync(NEXT_CONFIG, 'utf8');
    for (const prefix of PROXIED_PREFIXES) {
      expect(config, `next.config.js must rewrite ${prefix}:path*`).toContain(`source: '${prefix}:path*'`);
    }
  });
});
