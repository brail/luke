/**
 * Behavioral proof for `check-platform-integrity.ts`.
 *
 * A checker that has only ever been seen green is assumed to block, not known
 * to. Each case here materializes a throwaway git repository, breaks exactly one
 * thing, and asserts the corresponding invariant goes red.
 *
 * Both directions are covered on purpose. A deterministic gate has two failure
 * modes, and the second is the expensive one: an over-broad rule that reports
 * correct architecture as broken gets disabled within a week
 * (`lessons.md`, "A new lint rule must be probed on a bait file"). So the
 * legitimate cases — OpenTelemetry's intentionally mixed version lines, a
 * bounded scope wildcard, independently versioned `@types/*` — are asserted to
 * stay green with the same weight as the violations are asserted to fail.
 *
 * ## Verification procedure this suite does NOT cover
 *
 * These tests never invoke pnpm; they exercise a pure function. The *semantics*
 * encoded in the checker — that `--frozen-lockfile` re-applies the quarantine,
 * that `minimumReleaseAgeStrict: false` installs an immature version — were
 * established by running the real package manager. Any future proof of that
 * kind must run under the repository's declared `packageManager`: a scratch
 * directory without that field lets Corepack resolve a different pnpm, and the
 * wrong version answered one of those questions incorrectly before the version
 * banner gave it away.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import {
  VALID_REPO,
  withFile,
  withPolicy,
  withRootManifest,
  withoutFile,
  type RepoFiles,
} from './__fixtures__/platform/validRepo';
import { checkPlatformIntegrity } from './check-platform-integrity';

const created: string[] = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * Materialize files into a real git repository.
 *
 * git and not a bare directory because the checker discovers manifests with
 * `git ls-files`: that is deliberate — a gate must reason about tracked state
 * rather than whatever happens to sit on the disk — so the fixtures have to
 * offer it a repository to read.
 */
function repo(files: RepoFiles): string {
  const dir = mkdtempSync(join(tmpdir(), 'luke-platform-'));
  created.push(dir);

  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }

  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('add', '-A');

  return dir;
}

/** The invariant is violated: at least one problem matches. */
function expectFailure(files: RepoFiles, pattern: RegExp): void {
  const problems = checkPlatformIntegrity(repo(files));
  const matched = problems.filter(p => pattern.test(p.message));
  assert.ok(
    matched.length > 0,
    `expected a problem matching ${pattern}, got:\n` +
      (problems.map(p => `  - ${p.message}`).join('\n') || '  (none)')
  );
}

/** The configuration is legitimate: nothing is reported at all. */
function expectClean(files: RepoFiles): void {
  const problems = checkPlatformIntegrity(repo(files));
  assert.deepEqual(
    problems.map(p => p.message),
    [],
    'expected no problems'
  );
}

// ---------------------------------------------------------------------------
// The baseline must be clean, or every negative case below proves nothing.
// ---------------------------------------------------------------------------

test('baseline fixture satisfies every invariant', () => {
  expectClean(VALID_REPO);
});

test('zero-discovery: a tree with no tracked manifest throws rather than passing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'luke-platform-empty-'));
  created.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  assert.throws(() => checkPlatformIntegrity(dir), /no tracked package\.json/);
});

// ---------------------------------------------------------------------------
// P1 — workspace version alignment
// ---------------------------------------------------------------------------

test('P1 fails when one package is declared at two versions', () => {
  expectFailure(
    withFile(
      'apps/web/package.json',
      JSON.stringify({
        name: '@fixture/web',
        devDependencies: { typescript: '^5.0.0' },
      })
    ),
    /`typescript` is declared at 2 different versions/
  );
});

test('P1 ignores workspace: links, which carry no version to align', () => {
  expectClean(VALID_REPO);
});

// ---------------------------------------------------------------------------
// P2 — Node pin sites
// ---------------------------------------------------------------------------

test('P2 fails when one Node pin site disagrees', () => {
  expectFailure(withFile('.nvmrc', '22\n'), /Node pin sites disagree/);
});

test('P2 fails when a pin site is missing entirely', () => {
  expectFailure(withoutFile('apps/web/Dockerfile'), /Node pin site is missing/);
});

test('P2 accepts differing spellings of the same major', () => {
  // `v24` in .nvmrc and `>=24.0.0` in engines are the same approved major.
  expectClean(withFile('.nvmrc', 'v24\n'));
});

// ---------------------------------------------------------------------------
// P3 — package manager
// ---------------------------------------------------------------------------

test('P3 fails when packageManager is not an exact pin with an integrity hash', () => {
  expectFailure(
    withRootManifest(json => {
      json.packageManager = 'pnpm@11.24.0';
    }),
    /must pin pnpm to an exact version with its integrity hash/
  );
});

test('P3 fails when a foreign lockfile is tracked', () => {
  expectFailure(
    withFile('yarn.lock', '# yarn\n'),
    /non-pnpm lockfile is tracked/
  );
});

test('P3 fails when the pinned pnpm is below the declared engine floor', () => {
  expectFailure(
    withRootManifest(json => {
      json.engines.pnpm = '>=12.0.0';
    }),
    /engines\.pnpm` requires >=12/
  );
});

// ---------------------------------------------------------------------------
// P4 — release-age quarantine
// ---------------------------------------------------------------------------

test('P4a fails when the quarantine is absent', () => {
  expectFailure(
    withPolicy('minimumReleaseAgeStrict: true\n'),
    /`minimumReleaseAge` must be `4320`/
  );
});

test('P4a fails when the quarantine is weakened', () => {
  expectFailure(
    withPolicy('minimumReleaseAge: 60\nminimumReleaseAgeStrict: true\n'),
    /`minimumReleaseAge` must be `4320`/
  );
});

test('P4b fails when trustLockfile disables verification', () => {
  expectFailure(
    withPolicy(
      'minimumReleaseAge: 4320\nminimumReleaseAgeStrict: true\ntrustLockfile: true\n'
    ),
    /trustLockfile` is enabled/
  );
});

test('P4d fails when strict enforcement is turned off', () => {
  expectFailure(
    withPolicy('minimumReleaseAge: 4320\nminimumReleaseAgeStrict: false\n'),
    /`minimumReleaseAgeStrict` must be `true`/
  );
});

test('P4d fails when strict enforcement is merely omitted', () => {
  expectFailure(
    withPolicy('minimumReleaseAge: 4320\n'),
    /`minimumReleaseAgeStrict` must be `true`/
  );
});

// P4c — exclusions bounded and current, both directions.

const POLICY = 'minimumReleaseAge: 4320\nminimumReleaseAgeStrict: true\n';

test('P4c fails on a universal exclusion that silently disables the quarantine', () => {
  for (const selector of ["'*'", "'**'"]) {
    expectFailure(
      withPolicy(`${POLICY}minimumReleaseAgeExclude:\n  - ${selector}\n`),
      /exempts every package/
    );
  }
});

test('P4c accepts a bounded scope wildcard with a resolved match', () => {
  expectClean(
    withPolicy(`${POLICY}minimumReleaseAgeExclude:\n  - '@myorg/*'\n`)
  );
});

test('P4c fails on a bounded scope wildcard matching nothing resolved', () => {
  expectFailure(
    withPolicy(`${POLICY}minimumReleaseAgeExclude:\n  - '@nobody/*'\n`),
    /matches nothing the lockfile currently resolves/
  );
});

test('P4c fails on a stale version-specific exclusion', () => {
  // The lockfile resolves prettier 3.9.6; the exclusion still names 3.8.5.
  expectFailure(
    withPolicy(`${POLICY}minimumReleaseAgeExclude:\n  - prettier@3.8.5\n`),
    /matches nothing the lockfile currently resolves/
  );
});

test('P4c accepts a current version-specific exclusion', () => {
  expectClean(
    withPolicy(`${POLICY}minimumReleaseAgeExclude:\n  - prettier@3.9.6\n`)
  );
});

// ---------------------------------------------------------------------------
// P5 — dependency families
// ---------------------------------------------------------------------------

test('P5 fails when a governed family is split across majors', () => {
  expectFailure(
    withFile(
      'apps/web/package.json',
      JSON.stringify({
        name: '@fixture/web',
        dependencies: {
          react: '^19.2.8',
          'react-dom': '^19.2.8',
          '@trpc/client': '^10.45.0', // server is on 11
          '@trpc/react-query': '^11.18.0',
        },
        devDependencies: { typescript: '^6.0.3' },
      })
    ),
    /trpc family is split across majors/
  );
});

test('P5 leaves OpenTelemetry alone: mixed 0.x/1.x/2.x lines are correct upstream', () => {
  // The baseline already carries @opentelemetry/api 1.x, sdk-node 0.x and
  // resources 2.x. A naive same-major rule would report this as broken.
  expectClean(VALID_REPO);
});

test('P5 leaves @types/* alone: they version independently of the runtime', () => {
  // Baseline has react 19.2.8 with @types/react 19.2.18 and @types/react-dom 19.2.5.
  expectClean(VALID_REPO);
});

// ---------------------------------------------------------------------------
// P6 — security runner keeps an approved canonical shape
//
// The check is not a semantic proof that a script propagates failure. It admits
// two shapes Luke has approved — scanners chained with `&&`, or delegation to a
// single runner — and reports everything else. The `|| exit 1` case below is the
// honest edge: it is genuinely fail-closed and still rejected, because the
// alternative is a Bash semantic parser living inside a drift checker.
// ---------------------------------------------------------------------------

test('P6 rejects `;`, which discards the preceding scanner failure', () => {
  expectFailure(
    withRootManifest(json => {
      json.scripts['security:sast'] =
        'semgrep scan --config a.yml; semgrep scan --error';
    }),
    /joins commands with `;`/
  );
});

test('P6 rejects `||` as outside the canonical form', () => {
  expectFailure(
    withRootManifest(json => {
      json.scripts['security:sast'] =
        'semgrep scan --config a.yml || echo ignored';
    }),
    /joins commands with `\|\|`/
  );
});

test('P6 rejects `|| exit 1` too, though it is fail-closed — documented limit', () => {
  // Deliberate false positive. This shape does propagate failure, but
  // recognising it would mean reasoning about arbitrary shell. Rewrite it in a
  // canonical form instead; the checker is a form gate, not a proof engine.
  expectFailure(
    withRootManifest(json => {
      json.scripts['security:sast'] = 'semgrep scan --config a.yml || exit 1';
    }),
    /joins commands with `\|\|`/
  );
});

test('P6 accepts scanners chained with `&&` (canonical form 1)', () => {
  expectClean(VALID_REPO);
});

test('P6 accepts delegation to a single runner (canonical form 2)', () => {
  // The obligation moves into that runner, whose own exit status becomes the
  // script's.
  expectClean(
    withRootManifest(json => {
      json.scripts['security:sast'] = 'bash scripts/security-sast.sh';
    })
  );
});
