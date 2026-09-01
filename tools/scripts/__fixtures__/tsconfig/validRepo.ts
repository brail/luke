/**
 * A minimal repository whose TypeScript configuration satisfies every
 * architectural invariant.
 *
 * The behavioral cases in `check-tsconfig-integrity.test.ts` materialize this
 * into a throwaway git repository and mutate one thing at a time, so each case
 * proves exactly one invariant.
 *
 * ## Why this is data and not a directory of real files
 *
 * `checkTsconfigIntegrity` discovers configs with
 * `git ls-files '*tsconfig*.json'`. A fixture `tsconfig.json` committed under
 * `tools/` would therefore be read by the checker **when it runs against Luke
 * itself**, and its deliberately broken variants would be reported as real
 * failures in this repository. Declaring the tree here keeps the fixtures
 * permanent and reviewable without an exception list inside the checker — and
 * an exception list is how a checker starts becoming furniture.
 *
 * ## Why the paths are Luke's real paths
 *
 * The classification table in the checker is keyed by repository-relative path,
 * because that is what assigns a runtime to a surface. A fixture with invented
 * paths would exercise the "unclassified config" branch and nothing else, so
 * these mirror the real tree. The *contents* are fixture data: minimal, and not
 * claims about what Luke's own configs contain.
 *
 * ## Why there are package manifests here
 *
 * The workspace-boundary rules are structural: "another package" is derived
 * from `git ls-files '*package.json'`. Without these manifests every path in
 * the fixture would belong to the same (root) package, and both boundary tests
 * would pass while asserting nothing. `tools/` deliberately has none, mirroring
 * the real tree, so it is owned by the root package there too.
 */

/** Files of a repository, keyed by path relative to its root. */
export type RepoFiles = Record<string, string>;

/** JSON with a trailing newline, the way a config file is written. */
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const BASE = {
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022'],
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    isolatedModules: true,
  },
};

/** A Node project: NodeNext, neutral `lib` inherited from the base. */
function nodeProject(depth: number): unknown {
  return {
    extends: `${'../'.repeat(depth)}tsconfig.base.json`,
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      types: ['node'],
    },
    include: ['src/**/*'],
  };
}

const WEB = {
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    module: 'esnext',
    moduleResolution: 'bundler',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    jsx: 'preserve',
    noEmit: true,
    plugins: [{ name: 'next' }],
    paths: { '@/*': ['./src/*'] },
  },
  include: ['src/**/*'],
};

/** The isomorphic library: DOM, and only DOM, on top of the neutral base. */
const CORE = {
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    lib: ['ES2022', 'DOM'],
    types: ['node'],
  },
  include: ['src/**/*'],
};

/** A test project extends the project it tests, never the base directly. */
const TEST_PROJECT = {
  extends: './tsconfig.json',
  compilerOptions: { noEmit: true },
  include: ['src/**/*'],
};

/** Node code loaded by Vitest rather than by Node's own module loader. */
const API_TEST = {
  extends: './tsconfig.json',
  compilerOptions: {
    noEmit: true,
    module: 'ESNext',
    moduleResolution: 'Bundler',
    types: ['node', 'vitest/globals'],
  },
  include: ['src/**/*', 'test/**/*'],
};

/**
 * Minimal manifests.
 *
 * Their *location* is what the ownership rules read. Their `scripts` are read
 * too, by the project-invocation rule: every `tsc -p` here names a canonical
 * `tsconfig*.json`, which is the green half of that check.
 */
const MANIFESTS: RepoFiles = Object.fromEntries(
  [
    ['package.json', '@fixture/monorepo', { 'typecheck:tools': 'tsc -p tools/tsconfig.json' }],
    ['apps/api/package.json', '@fixture/api', { 'typecheck:test': 'tsc -p tsconfig.test.json' }],
    ['apps/web/package.json', '@fixture/web', { typecheck: 'tsc --noEmit' }],
    ['packages/core/package.json', '@fixture/core', { build: 'tsc' }],
    ['packages/nav/package.json', '@fixture/nav', { build: 'tsc' }],
    ['packages/calendar/package.json', '@fixture/calendar', { build: 'tsc' }],
  ].map(([path, name, scripts]) => [
    path as string,
    json({ name, private: true, scripts }),
  ])
);

/**
 * Real source files.
 *
 * The root-file ownership rule reads what TypeScript actually selected through
 * `files`/`include`, and an `include` that matches nothing selects nothing — so
 * without these the rule would be green on an empty program and prove nothing.
 */
const SOURCES: RepoFiles = Object.fromEntries(
  [
    'apps/api/src/index.ts',
    'apps/api/test/api.test.ts',
    'apps/web/src/index.ts',
    'packages/core/src/index.ts',
    'packages/nav/src/index.ts',
    'packages/calendar/src/index.ts',
    'tools/lib.ts',
    'scripts/main.ts',
  ].map(path => [path, 'export const value = 1;\n'])
);

export const VALID_REPO: RepoFiles = {
  ...MANIFESTS,
  ...SOURCES,
  'tsconfig.base.json': json(BASE),
  'tsconfig.json': json({
    extends: './tsconfig.base.json',
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      types: ['node'],
      noEmit: true,
    },
    include: ['scripts/**/*.ts'],
  }),
  'apps/api/tsconfig.json': json(nodeProject(2)),
  'apps/api/tsconfig.scripts.json': json({
    extends: './tsconfig.json',
    include: ['scripts/**/*.ts'],
  }),
  'apps/api/tsconfig.test.json': json(API_TEST),
  'apps/web/tsconfig.json': json(WEB),
  'apps/web/tsconfig.test.json': json(TEST_PROJECT),
  'packages/core/tsconfig.json': json(CORE),
  'packages/core/tsconfig.test.json': json(TEST_PROJECT),
  'packages/nav/tsconfig.json': json(nodeProject(2)),
  'packages/calendar/tsconfig.json': json(nodeProject(2)),
  'packages/calendar/tsconfig.test.json': json(TEST_PROJECT),
  'tools/tsconfig.json': json(nodeProject(1)),
};

/** The valid tree with one file replaced. */
export function withFile(path: string, contents: string): RepoFiles {
  return { ...VALID_REPO, [path]: contents };
}

/** The valid tree with one file removed. */
export function withoutFile(path: string): RepoFiles {
  const files = { ...VALID_REPO };
  delete files[path];
  return files;
}

/** The valid tree with one config's `compilerOptions` patched. */
export function withCompilerOptions(
  path: string,
  patch: Record<string, unknown>
): RepoFiles {
  const original = JSON.parse(VALID_REPO[path]) as {
    compilerOptions?: Record<string, unknown>;
  };
  return withFile(
    path,
    json({
      ...original,
      compilerOptions: { ...(original.compilerOptions ?? {}), ...patch },
    })
  );
}
