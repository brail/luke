/**
 * A minimal repository that satisfies every platform invariant.
 *
 * The behavioral fixtures in `check-platform-integrity.test.ts` materialize this
 * into a throwaway git repository and mutate one thing at a time, so each case
 * proves exactly one invariant.
 *
 * ## Why this is data and not a directory of real files
 *
 * `checkPlatformIntegrity` discovers manifests with `git ls-files '*package.json'`.
 * A fixture `package.json` committed under `tools/` would therefore be read by
 * the checker **when it runs against Luke itself**, and its deliberately
 * mismatched versions would be reported as real alignment and family failures in
 * this repo. Declaring the tree here keeps the fixture permanent and reviewable
 * without needing an exception list inside the checker — and an exception list
 * is how a checker starts becoming furniture.
 *
 * Versions below are fixture data. They are not claims about what Luke installs,
 * and nothing reads them as such.
 */

/** Files of a repository, keyed by path relative to its root. */
export type RepoFiles = Record<string, string>;

const ROOT_PACKAGE_JSON = {
  name: 'fixture-monorepo',
  private: true,
  packageManager: 'pnpm@11.24.0+sha512.abcdef0123456789abcdef0123456789',
  engines: { node: '>=24.0.0', pnpm: '>=10.0.0' },
  scripts: {
    security: 'pnpm security:sast && pnpm security:secrets',
    'security:sast': 'semgrep scan --config a.yml && semgrep scan --error',
    'security:secrets': 'gitleaks detect --source .',
  },
  devDependencies: { typescript: '^6.0.3' },
};

const API_PACKAGE_JSON = {
  name: '@fixture/api',
  private: true,
  dependencies: {
    '@fixture/core': 'workspace:*',
    prisma: '7.10.0',
    '@prisma/client': '^7.10.0',
    '@prisma/adapter-pg': '^7.10.0',
    '@trpc/server': '^11.18.0',
    // OpenTelemetry deliberately spans 0.x experimental and 1.x/2.x stable
    // lines. This is correct upstream design and must stay green.
    '@opentelemetry/api': '^1.9.1',
    '@opentelemetry/sdk-node': '^0.219.0',
    '@opentelemetry/resources': '^2.10.0',
  },
  devDependencies: { typescript: '^6.0.3' },
};

const WEB_PACKAGE_JSON = {
  name: '@fixture/web',
  private: true,
  dependencies: {
    react: '^19.2.8',
    'react-dom': '^19.2.8',
    '@trpc/client': '^11.18.0',
    '@trpc/react-query': '^11.18.0',
  },
  devDependencies: {
    typescript: '^6.0.3',
    // Types version independently of the runtime packages they describe.
    '@types/react': '^19.2.18',
    '@types/react-dom': '^19.2.5',
  },
};

const WORKSPACE_YAML = `packages:
  - apps/*

minimumReleaseAge: 4320
minimumReleaseAgeStrict: true
minimumReleaseAgeExclude:
  - electron-to-chromium
`;

/**
 * A lockfile in the v9 shape the parser reads: a \`packages:\` block whose keys
 * are \`name@version\`. Only the entries the exclusion cases need are present.
 */
const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

packages:

  'electron-to-chromium@1.5.416':
    resolution: {integrity: sha512-fixture}
  'prettier@3.9.6':
    resolution: {integrity: sha512-fixture}
  '@myorg/widget@1.0.0':
    resolution: {integrity: sha512-fixture}
  'react@19.2.8':
    resolution: {integrity: sha512-fixture}

snapshots:

  'react@19.2.8': {}
`;

const SETUP_ACTION = `name: Setup workspace
description: fixture
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v7
      with:
        node-version: '24'
`;

/** The healthy baseline. Every negative case is a mutation of exactly one file. */
export const VALID_REPO: RepoFiles = {
  'package.json': JSON.stringify(ROOT_PACKAGE_JSON, null, 2),
  'apps/api/package.json': JSON.stringify(API_PACKAGE_JSON, null, 2),
  'apps/web/package.json': JSON.stringify(WEB_PACKAGE_JSON, null, 2),
  'pnpm-workspace.yaml': WORKSPACE_YAML,
  'pnpm-lock.yaml': LOCKFILE,
  '.nvmrc': '24\n',
  '.github/actions/setup-workspace/action.yml': SETUP_ACTION,
  'apps/api/Dockerfile': 'FROM node:24-alpine AS base\n',
  'apps/web/Dockerfile': 'FROM node:24-alpine AS base\n',
};

/** A copy of the baseline with one file replaced. */
export function withFile(path: string, contents: string): RepoFiles {
  return { ...VALID_REPO, [path]: contents };
}

/** A copy of the baseline with one file removed. */
export function withoutFile(path: string): RepoFiles {
  const files = { ...VALID_REPO };
  delete files[path];
  return files;
}

/** A copy of the baseline whose root manifest has been edited. */
export function withRootManifest(
  edit: (json: typeof ROOT_PACKAGE_JSON) => void
): RepoFiles {
  const json = JSON.parse(JSON.stringify(ROOT_PACKAGE_JSON));
  edit(json);
  return withFile('package.json', JSON.stringify(json, null, 2));
}

/** A copy of the baseline whose `pnpm-workspace.yaml` policy block is replaced. */
export function withPolicy(policy: string): RepoFiles {
  return withFile('pnpm-workspace.yaml', `packages:\n  - apps/*\n\n${policy}`);
}
