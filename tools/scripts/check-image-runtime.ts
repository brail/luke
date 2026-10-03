/**
 * Proves what a runtime image contains, from inside the image.
 *
 * Both runtime images used to copy the builder's full `node_modules`, so the
 * whole development toolchain — and every advisory against it — shipped to
 * production, and nothing could tell: CI built no image and the release pushed
 * whatever it built. This script is the proof, run by the image's own Node
 * (Node 24 strips the types) with this directory mounted read-only:
 *
 *   docker run --rm -v "$PWD/tools/scripts:/check:ro" --entrypoint node <image> \
 *     /check/check-image-runtime.ts <api|web>
 *
 * One contract per layout, because the two layouts promise different things:
 *
 * - **api** — the store under `node_modules/.pnpm` holds exactly the closure of
 *   the workspace manifests' `dependencies`. An entry nothing reaches is an
 *   orphan: an image built from the full tree is full of them. A `dependencies`
 *   entry that does not resolve is a runtime dependency the image lost. Then the
 *   native addons the production install rebuilt actually run.
 * - **web** — Next's standalone output ships only the files its traces name, and
 *   libraries inlined into the server bundles are not packages at all, so a
 *   package closure would refuse a correct image. The authority is the builder's
 *   own list of what the runtime stage may contain (`web-inventory`, written to
 *   `/runtime-files.txt`, outside the tree it describes); then the server boots.
 *
 * Self-contained on purpose: Node built-ins, erasable TypeScript syntax, and
 * the one shared parser imported by its real file name, because the image runs
 * it with no loader. The checks are pure functions over a root directory, so
 * the tests drive them against throwaway trees.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, sep } from 'node:path';

import { sequence } from './lib/pnpmWorkspace.ts';

/** Where the builder writes, and the runner carries, the web stage's entitled entries. */
export const WEB_INVENTORY_FILE = '/runtime-files.txt';

/** The image's application root: every runner stage works under `WORKDIR /app`. */
const IMAGE_ROOT = '/app';

/** The web app, relative to the repository root and to the standalone tree alike. */
const WEB_APP = 'apps/web';

interface Manifest {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function readManifest(dir: string): Manifest | null {
  try {
    // A package.json is JSON by contract; only these three groups are read.
    return JSON.parse(
      readFileSync(join(dir, 'package.json'), 'utf8')
    ) as Manifest;
  } catch {
    return null;
  }
}

/** The workspace package directories `pnpm-workspace.yaml` declares, root included. */
export function workspaceDirs(root: string): string[] {
  const globs = sequence(
    readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
    'packages',
    {
      strict: true,
    }
  );
  if (globs === null)
    throw new Error('pnpm-workspace.yaml declares no `packages`.');

  const dirs = [root];
  for (const glob of globs) {
    if (glob.endsWith('/*') && !glob.slice(0, -2).includes('*')) {
      const parent = join(root, glob.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent).sort()) {
        const dir = join(parent, entry);
        if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
      }
    } else if (!glob.includes('*')) {
      const dir = join(root, glob);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    } else {
      throw new Error(
        `Unsupported workspace glob \`${glob}\`: only \`dir/*\` and plain paths.`
      );
    }
  }
  return dirs;
}

/**
 * Node's package lookup from `from`: the `node_modules` of `from` and of every
 * ancestor that is not itself a `node_modules`, the real path of the first hit.
 * Read from the directory rather than through `require.resolve`, which a
 * package's `exports` may forbid for `package.json`.
 */
export function resolvePackage(from: string, name: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    if (basename(dir) !== 'node_modules') {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(candidate)) return realpathSync(candidate);
    }
    if (dirname(dir) === dir) return null;
  }
}

export interface ClosureReport {
  /** Store entries (`node_modules/.pnpm/<id>`) nothing reaches. */
  orphans: string[];
  /** `<package dir> → <name>` for every `dependencies` entry that does not resolve. */
  unresolved: string[];
  storeEntries: number;
}

/**
 * Walks the production closure from the workspace manifests and compares it
 * with the store. Edges are `dependencies`, `optionalDependencies` and peers
 * that are installed; an optional entry overrides a `dependencies` entry of the
 * same name, and an optional absent on this platform is not an error. A
 * workspace manifest's `devDependencies` are never edges — that is the point.
 *
 * Limit: it audits store entries, not extra files inside a reachable package or
 * outside the store.
 */
export function auditClosure(rootDir: string): ClosureReport {
  const root = realpathSync(rootDir);
  const store = join(root, 'node_modules', '.pnpm');
  const entries = existsSync(store)
    ? readdirSync(store, { withFileTypes: true })
        // `.pnpm/node_modules` is pnpm's hidden hoisting directory, `lock.yaml` its record.
        .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
        .map(entry => entry.name)
    : [];

  const reached = new Set<string>();
  const visited = new Set<string>();
  const unresolved: string[] = [];
  const queue: string[] = [];

  const follow = (
    dir: string,
    manifest: Manifest,
    groups: Array<keyof Manifest>
  ): void => {
    const optional = manifest.optionalDependencies ?? {};
    const names = new Set(
      groups.flatMap(group => Object.keys(manifest[group] ?? {}))
    );
    for (const name of names) {
      const target = resolvePackage(dir, name);
      if (target !== null) {
        queue.push(target);
      } else if (name in (manifest.dependencies ?? {}) && !(name in optional)) {
        unresolved.push(`${relative(root, dir) || '.'} → ${name}`);
      }
    }
  };

  for (const dir of workspaceDirs(root)) {
    visited.add(dir);
    const manifest = readManifest(dir);
    if (manifest !== null)
      follow(dir, manifest, ['dependencies', 'optionalDependencies']);
  }

  for (let dir = queue.pop(); dir !== undefined; dir = queue.pop()) {
    if (visited.has(dir)) continue;
    visited.add(dir);
    if (dir.startsWith(store + sep))
      reached.add(dir.slice(store.length + 1).split(sep)[0]);
    const manifest = readManifest(dir);
    if (manifest !== null) {
      follow(dir, manifest, [
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
      ]);
    }
  }

  return {
    orphans: entries.filter(entry => !reached.has(entry)).sort(),
    unresolved: unresolved.sort(),
    storeEntries: entries.length,
  };
}

/**
 * Every entry under `dir` as `f <path>` or `l <path>`, `lstat` only: a symlink
 * is listed as a link and never followed, so pnpm's links inside the standalone
 * tree are compared as what they are. Directories are implied by their entries.
 */
export function listEntries(dir: string, prefix = ''): string[] {
  const lines: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const rel = prefix + relative(dir, path).split(sep).join('/');
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) lines.push(`l ${rel}`);
      else if (stat.isDirectory()) walk(path);
      else lines.push(`f ${rel}`);
    }
  };
  walk(dir);
  return lines;
}

/**
 * What the web runtime stage is entitled to contain, at its final paths under
 * the image root: the standalone tree as `next build` wrote it (from its traces,
 * plus `package.json` and `server.js`), `.next/static` and `public`.
 */
export function webInventory(repoRoot: string): string[] {
  const web = join(repoRoot, WEB_APP);
  return [
    ...listEntries(join(web, '.next', 'standalone')),
    ...listEntries(join(web, '.next', 'static'), `${WEB_APP}/.next/static/`),
    ...listEntries(join(web, 'public'), `${WEB_APP}/public/`),
  ].sort();
}

/** Entries in the tree and not on the list, and the reverse. */
export function auditInventory(
  root: string,
  inventory: string
): { extra: string[]; missing: string[] } {
  const entitled = new Set(inventory.split('\n').filter(line => line !== ''));
  const actual = new Set(listEntries(root));
  return {
    extra: [...actual].filter(line => !entitled.has(line)).sort(),
    missing: [...entitled].filter(line => !actual.has(line)).sort(),
  };
}

/** Width of a PNG from its IHDR chunk, or null when the bytes are not a PNG. */
export function pngWidth(bytes: Uint8Array): number | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte))
    return null;
  return Buffer.from(bytes).readUInt32BE(16);
}

/** The native addons the production install rebuilt, run rather than loaded. */
async function apiProbes(root: string): Promise<string[]> {
  const problems: string[] = [];
  const api = join(root, 'apps', 'api');
  const load = createRequire(join(api, 'package.json'));

  try {
    // Only the two functions called here; the package ships its own types, which
    // this script, run outside any workspace, cannot see.
    const argon2 = load('argon2') as {
      hash(password: string): Promise<string>;
      verify(hash: string, password: string): Promise<boolean>;
    };
    const hash = await argon2.hash('image-check');
    if (
      !(await argon2.verify(hash, 'image-check')) ||
      (await argon2.verify(hash, 'other'))
    ) {
      problems.push('argon2: hash/verify round trip gave the wrong answer.');
    }
  } catch (err) {
    problems.push(`argon2: ${String(err)}`);
  }

  try {
    // Same reason: the three calls this probe makes, nothing more.
    type Pipeline = {
      resize(width: number): Pipeline;
      png(): Pipeline;
      toBuffer(): Promise<Uint8Array>;
    };
    const sharp = load('sharp') as (input: {
      create: {
        width: number;
        height: number;
        channels: 3;
        background: string;
      };
    }) => Pipeline;
    const out = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#ffffff' },
    })
      .resize(4)
      .png()
      .toBuffer();
    if (pngWidth(out) !== 4)
      problems.push('sharp: resize to 4 px did not produce a 4 px PNG.');
  } catch (err) {
    problems.push(`sharp: ${String(err)}`);
  }

  try {
    load('@luke/db');
  } catch (err) {
    problems.push(`@luke/db: ${String(err)}`);
  }

  // What `entrypoint.sh` runs at boot, short of a database: the CLI starts, loads
  // `prisma.config.ts` and parses the schema directory.
  const db = join(root, 'packages', 'db');
  const prisma = spawnSync(
    join(db, 'node_modules', '.bin', 'prisma'),
    ['validate'],
    {
      cwd: db,
      encoding: 'utf8',
      env: {
        // nosemgrep: luke-no-direct-env -- the child inherits the image's environment (PATH); the only value set is a fixed test URL, nothing is read
        ...process.env,
        DATABASE_URL: 'postgresql://image-check@127.0.0.1:1/image-check',
      },
    }
  );
  if (prisma.status !== 0) {
    problems.push(
      `prisma validate exited ${prisma.status}: ${(prisma.stderr || prisma.stdout).trim()}`
    );
  }
  return problems;
}

const SMOKE_PORT = 3000;
const SMOKE_BOOT_TIMEOUT_MS = 60_000;

/**
 * Boots the standalone server with the image's own environment — `HOSTNAME`
 * included, so a server bound to the container address instead of every
 * interface fails here — and probes it on loopback. No probe needs the API.
 */
async function webSmoke(root: string): Promise<string[]> {
  const problems: string[] = [];
  const base = `http://127.0.0.1:${SMOKE_PORT}`;
  const server = spawn(process.execPath, [join(root, WEB_APP, 'server.js')], {
    env: {
      // nosemgrep: luke-no-direct-env -- the server must inherit the image's environment, HOSTNAME above all, which is what the smoke tests; the values set are fixed test values
      ...process.env,
      PORT: String(SMOKE_PORT),
      NEXTAUTH_SECRET: 'image-check-secret-not-used-anywhere-else',
      NEXTAUTH_URL: base,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', chunk => (output += String(chunk)));
  server.stderr.on('data', chunk => (output += String(chunk)));

  const get = (
    path: string,
    headers: Record<string, string> = {}
  ): Promise<Response> => fetch(base + path, { headers, redirect: 'manual' });

  try {
    const deadline = Date.now() + SMOKE_BOOT_TIMEOUT_MS;
    let login: Response | null = null;
    while (
      login === null &&
      Date.now() < deadline &&
      server.exitCode === null
    ) {
      login = await get('/login').catch(() => null);
      if (login === null) await new Promise(done => setTimeout(done, 500));
    }
    if (login === null) {
      return [
        `server did not answer on ${base} within ${SMOKE_BOOT_TIMEOUT_MS / 1000}s:\n${output.trim()}`,
      ];
    }
    if (login.status !== 200)
      problems.push(`/login answered ${login.status}, expected 200.`);

    const csrf = await get('/api/auth/csrf');
    const token: unknown =
      csrf.status === 200
        ? ((await csrf.json()) as { csrfToken?: unknown }).csrfToken
        : null;
    if (typeof token !== 'string' || token === '') {
      problems.push(
        `/api/auth/csrf answered ${csrf.status} without a csrfToken.`
      );
    }

    // A protected page renders for an anonymous visitor: the redirect to /login
    // is client-side (`(app)/layout.tsx`).
    const dashboard = await get('/dashboard');
    if (dashboard.status !== 200)
      problems.push(`/dashboard answered ${dashboard.status}, expected 200.`);

    const image = await get('/_next/image?url=%2Fauthor.png&w=64&q=75', {
      accept: 'image/png',
    });
    const width =
      image.status === 200
        ? pngWidth(new Uint8Array(await image.arrayBuffer()))
        : null;
    if (width !== 64) {
      problems.push(
        `/_next/image answered ${image.status} with width ${width}, expected a 64 px PNG.`
      );
    }
  } finally {
    server.kill();
  }
  return problems;
}

function report(scope: string, problems: string[], summary: string): void {
  if (problems.length === 0) {
    console.log(`[image-runtime] ok — ${scope}: ${summary}`);
    return;
  }
  console.error(`[image-runtime] ${scope}: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
}

/** At most `limit` items, then a count of the rest. */
function sample(items: string[], limit = 25): string {
  const shown = items.slice(0, limit).join(', ');
  return items.length > limit
    ? `${shown}, … and ${items.length - limit} more`
    : shown;
}

async function main(): Promise<void> {
  const mode = process.argv[2];

  if (mode === 'web-inventory') {
    process.stdout.write(`${webInventory(process.cwd()).join('\n')}\n`);
    return;
  }

  if (mode === 'api') {
    const closure = auditClosure(IMAGE_ROOT);
    const problems = [
      ...(closure.orphans.length > 0
        ? [
            `${closure.orphans.length} of ${closure.storeEntries} store entries are reached by no production dependency: ${sample(closure.orphans)}`,
          ]
        : []),
      ...closure.unresolved.map(edge => `unresolved dependency: ${edge}`),
      ...(await apiProbes(IMAGE_ROOT)),
    ];
    report(
      'api',
      problems,
      `${closure.storeEntries} store entries, all reachable; argon2, sharp, @luke/db and the prisma CLI run.`
    );
    return;
  }

  if (mode === 'web') {
    if (!existsSync(WEB_INVENTORY_FILE)) {
      report(
        'web',
        [
          `${WEB_INVENTORY_FILE} is missing: the image does not say what it may contain.`,
        ],
        ''
      );
      return;
    }
    const { extra, missing } = auditInventory(
      IMAGE_ROOT,
      readFileSync(WEB_INVENTORY_FILE, 'utf8')
    );
    const problems = [
      ...(extra.length > 0
        ? [`${extra.length} entries not built by Next: ${sample(extra)}`]
        : []),
      ...(missing.length > 0
        ? [`${missing.length} entitled entries absent: ${sample(missing)}`]
        : []),
    ];
    // The smoke writes `.next/cache`, so it only runs on a tree that passed.
    if (problems.length === 0) problems.push(...(await webSmoke(IMAGE_ROOT)));
    report(
      'web',
      problems,
      'only the traced standalone tree, static assets and public; the server answers.'
    );
    return;
  }

  throw new Error('Usage: check-image-runtime.ts <api|web|web-inventory>');
}

// The image runs this file as an ES module and the tests load it through tsx as
// CommonJS, so neither `require.main` nor `import.meta` exists in both.
if (
  process.argv[1] !== undefined &&
  basename(process.argv[1]) === 'check-image-runtime.ts'
) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
