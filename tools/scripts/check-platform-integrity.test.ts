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
  withApiManifest,
  withCoreManifest,
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

// ---------------------------------------------------------------------------
// P7 — published package contracts
//
// A workspace other workspaces compile against must resolve to its build, and
// publish nothing else. The defect is not hypothetical: `@luke/api` pointed
// `main`/`types` at `./src/index.ts` with no `exports` map, so `apps/web` and
// the root scripts project each compiled 129 Fastify server files, and
// `@luke/api/src/index.ts` resolved for anyone who asked.
//
// Each negative below was first confirmed to pass a narrower version of this
// rule — one that only rejected the literal string `src` in entry-point values.
// They are the bypasses that version admitted.
// ---------------------------------------------------------------------------

test('P7 fails when a published contract points `types` into src', () => {
  expectFailure(
    withApiManifest(json => {
      json.types = './src/index.ts';
    }),
    /entry point `\.\/src\/index\.ts` resolves outside `dist\/`/
  );
});

test('P7 fails when a published contract points `main` into src', () => {
  expectFailure(
    withApiManifest(json => {
      json.main = './src/index.ts';
    }),
    /entry point `\.\/src\/index\.ts` resolves outside `dist\/`/
  );
});

test('P7 fails when an exports condition reaches into src', () => {
  // The subtle regression: `main`/`types` stay honest while a condition inside
  // the map hands source back. Nested values are read, not just top-level ones.
  expectFailure(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './src/index.ts', default: './dist/index.js' },
      };
    }),
    /entry point `\.\/src\/index\.ts` resolves outside `dist\/`/
  );
});

test('P7 fails when entry points resolve outside dist without naming src', () => {
  // `./build` is not source, so a rule that only looked for `src` accepted it.
  // It is still not the tree `files` ships or the one the build writes.
  expectFailure(
    withApiManifest(json => {
      json.main = './build/index.js';
      json.types = './build/index.d.ts';
      json.exports = {
        '.': { types: './build/index.d.ts', default: './build/index.js' },
      };
    }),
    /entry point `\.\/build\/index\.d\.ts` resolves outside `dist\/`/
  );
});

test('P7 fails when a published contract declares no exports map', () => {
  expectFailure(
    withApiManifest(json => {
      delete json.exports;
    }),
    /declares no `exports` map/
  );
});

test('P7 fails on a wildcard exports key that republishes the whole package', () => {
  // `"./*": "./*"` re-opens by pattern exactly what the map was added to close.
  // Every declared target looks legitimate; the key is what leaks.
  expectFailure(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './*': './*',
      };
    }),
    /publishes by pattern/
  );
});

test('P7 fails on a wildcard exports key even when it points inside dist', () => {
  // Narrower, still a pattern: it publishes every internal declaration in the
  // build, which is the 160 files the contract deliberately does not expose.
  expectFailure(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './*': './dist/*',
      };
    }),
    /publishes by pattern/
  );
});

test('P7 fails when a published contract declares no files allowlist', () => {
  expectFailure(
    withApiManifest(json => {
      delete json.files;
    }),
    /declares no `files` allowlist/
  );
});

test('P7 fails on an empty files array, which ships none of the contract', () => {
  expectFailure(
    withApiManifest(json => {
      json.files = [];
    }),
    /`files` does not list `dist`/
  );
});

test('P7 fails on a files array that omits dist', () => {
  expectFailure(
    withApiManifest(json => {
      json.files = ['README.md'];
    }),
    /`files` does not list `dist`/
  );
});

test('P7 fails when files ships source beside the build', () => {
  expectFailure(
    withApiManifest(json => {
      json.files = ['dist', 'src'];
    }),
    /`files` lists `src`, shipping source beside the build/
  );
});

test('P7 accepts a contract whose every entry point resolves into dist', () => {
  expectClean(VALID_REPO);
});

test('P7 accepts explicit subpath exports, which are a boundary and not a leak', () => {
  // `@luke/core` publishes three of these. Publishing more than one entry is
  // not the defect; publishing source, or publishing by pattern, is.
  expectClean(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './server': { types: './dist/server/index.d.ts', default: './dist/server/index.js' },
        './utils/date': { types: './dist/utils/date.d.ts', default: './dist/utils/date.js' },
        './package.json': './package.json',
      };
    })
  );
});

test('P7 exempts ./package.json, the one published target outside the build', () => {
  expectClean(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './package.json': './package.json',
      };
    })
  );
});

test('P7 does not mistake a `src` substring inside a longer segment for the directory', () => {
  // `dist/srcmap` is not `src`. An over-broad rule that reports correct
  // architecture as broken gets disabled within a week.
  expectClean(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './dist/srcmap/index.d.ts', default: './dist/srcmap/index.js' },
      };
      json.types = './dist/srcmap/index.d.ts';
      json.main = './dist/srcmap/index.js';
    })
  );
});

test('P7 does not read condition names as subpaths', () => {
  // "types"/"default"/"import" are conditions, not paths, and none of them can
  // carry a pattern. Treating them as subpath keys would be harmless here but
  // would misreport the moment someone used a condition containing a `*`.
  expectClean(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' },
      };
    })
  );
});

// ---------------------------------------------------------------------------
// P8 — the Web runtime image carries no API source
//
// Matching is by containment, not by string equality. A rule that looked for
// the literal `apps/api/src` in a COPY line accepted three copies that place
// the same files in the image without naming it.
// ---------------------------------------------------------------------------

const WEB_DOCKERFILE_BUILDER = `FROM node:24-alpine AS base
FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm --filter @luke/api build
`;

/** The builder stage plus a runner stage containing exactly `body`. */
function webDockerfile(body: string): RepoFiles {
  return withFile(
    'apps/web/Dockerfile',
    `${WEB_DOCKERFILE_BUILDER}FROM base AS runner\n${body}`
  );
}

test('P8 fails when the runner stage copies apps/api/src', () => {
  expectFailure(
    webDockerfile('COPY --from=builder /app/apps/api/src ./apps/api/src\n'),
    /overlaps `apps\/api\/src`/
  );
});

test('P8 fails on a parent-directory copy that carries API source with it', () => {
  expectFailure(
    webDockerfile('COPY --from=builder /app/apps/api ./apps/api\n'),
    /copies `apps\/api`, which overlaps `apps\/api\/src`/
  );
});

test('P8 fails on an apps/ copy, two levels above the source', () => {
  expectFailure(
    webDockerfile('COPY --from=builder /app/apps ./apps\n'),
    /copies `apps`, which overlaps `apps\/api\/src`/
  );
});

test('P8 fails on a wholesale copy of the build root', () => {
  expectFailure(
    webDockerfile('COPY --from=builder /app ./\n'),
    /copies `\/`, which overlaps `apps\/api\/src`/
  );
});

test('P8 reads every source operand, not only the first', () => {
  // `COPY src1 src2 dest/` is valid Docker. Checking one operand would miss the
  // rest.
  expectFailure(
    webDockerfile('COPY --from=builder /app/apps/web/public /app/apps/api/src ./stuff/\n'),
    /overlaps `apps\/api\/src`/
  );
});

test('P8 ignores the builder stage, which legitimately holds the whole repository', () => {
  // The builder must see API source — it is what the contract is compiled from.
  // A rule that read the whole file would make the fix impossible.
  expectClean(
    webDockerfile('COPY --from=builder /app/apps/web/.next ./apps/web/.next\n')
  );
});

test('P8 does not fire on a mere mention of the path outside a COPY', () => {
  expectClean(
    webDockerfile(
      '# apps/api/src is deliberately absent here — see the note above.\n' +
        'COPY --from=builder /app/apps/web/.next ./apps/web/.next\n'
    )
  );
});

test('P8 accepts sibling directories that cannot contain API source', () => {
  // apps/web and packages/core are what the runner legitimately carries, and
  // apps/api/dist would be too — none of them contains apps/api/src.
  expectClean(
    webDockerfile(
      'COPY --from=builder /app/apps/web/.next ./apps/web/.next\n' +
        'COPY --from=builder /app/packages/core/dist ./packages/core/dist\n' +
        'COPY --from=builder /app/apps/api/dist ./apps/api/dist\n'
    )
  );
});

// ---------------------------------------------------------------------------
// P7/P8 — bypasses found by review of the first implementation.
//
// Each case below was confirmed to pass the previous version of the rule, on
// this fixture and against the real repository, before the rule was tightened.
// ---------------------------------------------------------------------------

test('P7 fails on an entry point that traverses out of dist with ..', () => {
  // `./dist/../src/index.ts` begins with `dist` and lands in `src`. A rule
  // reading only the first segment accepted it.
  expectFailure(
    withApiManifest(json => {
      json.types = './dist/../src/index.ts';
    }),
    /traverses out of its own directory with `\.\.`/
  );
});

test('P7 fails on `exports: null`, which removes the map entirely', () => {
  // Not "no opinion": with a null map every path in the package resolves again.
  // `undefined`-only checking read this as a declared map with no entries.
  expectFailure(
    withApiManifest(json => {
      json.exports = null;
    }),
    /declares no `exports` map/
  );
});

test('P7 fails on a files glob that matches every top-level entry', () => {
  for (const glob of ['**', '*']) {
    expectFailure(
      withApiManifest(json => {
        json.files = ['dist', glob];
      }),
      /whose first segment is a glob/
    );
  }
});

test('P7 accepts a bounded glob under a real directory', () => {
  // `dist/**` is the ordinary way to say "the build tree". The first segment
  // still bounds it, so it is not the defect above.
  expectClean(
    withApiManifest(json => {
      json.files = ['dist', 'dist/**'];
    })
  );
});

test('P7 accepts a null exports entry, the standard way to block a subpath', () => {
  // Blocking must stay legal: `"./internal": null` refuses a subpath rather
  // than publishing one, which is the boundary being drawn, not a hole in it.
  expectClean(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './internal': null,
        './package.json': './package.json',
      };
    })
  );
});

test('P7 reports a declared contract whose manifest is not tracked', () => {
  // A silent skip made the rule vacuous exactly when a package was renamed or
  // untracked — the case where nothing else would notice either.
  expectFailure(
    withoutFile('packages/core/package.json'),
    /declared in `PUBLISHED_CONTRACTS` but no such manifest is tracked/
  );
});

test('P7 checks the second registered contract, not only the first', () => {
  // Both entries must be live. Breaking Core alone has to go red.
  expectFailure(
    withCoreManifest(json => {
      json.types = './src/index.ts';
    }),
    /entry point `\.\/src\/index\.ts` resolves outside `dist\/`/
  );
});

test('P8 fails on a descendant copy, which is still API source in the image', () => {
  // Containment was one-directional: only an ancestor of `apps/api/src` was
  // caught, so copying a subdirectory of it passed.
  expectFailure(
    webDockerfile('COPY --from=builder /app/apps/api/src/routers ./apps/api/src/routers\n'),
    /copies `apps\/api\/src\/routers`, which overlaps `apps\/api\/src`/
  );
});

test('P8 reads the JSON array COPY form, with the flags outside the array', () => {
  // The form Docker requires for paths containing spaces. Flags are not array
  // elements — an earlier test put `--from=builder` inside the brackets, which
  // is not valid Docker and so proved nothing about the real syntax.
  expectFailure(
    webDockerfile('COPY --from=builder ["/app/apps/api/src", "./apps/api/src"]\n'),
    /overlaps `apps\/api\/src`/
  );
});

test('P8 folds line continuations into one instruction', () => {
  // Split across three lines, the first had no operands and the rest did not
  // start with COPY, so a per-line reader saw no copy at all.
  expectFailure(
    webDockerfile('COPY --from=builder \\\n  /app/apps/api/src \\\n  ./apps/api/src\n'),
    /overlaps `apps\/api\/src`/
  );
});

test('P8 still accepts a legitimate multi-line copy of the web build', () => {
  expectClean(
    webDockerfile('COPY --from=builder \\\n  /app/apps/web/.next \\\n  ./apps/web/.next\n')
  );
});

// ---------------------------------------------------------------------------
// P9 — the development lifecycle bootstraps itself
// ---------------------------------------------------------------------------

test('P9 fails when the Prisma client is not generated on install', () => {
  // Reproduced on a genuinely fresh clone: `pnpm install && pnpm dev` died at
  // `@luke/nav#build` with TS2305 and no development task ever started.
  expectFailure(
    withRootManifest(json => {
      delete (json.scripts as Record<string, unknown>).postinstall;
    }),
    /`postinstall` must run `prisma generate`/
  );
});

test('P9 fails when postinstall exists but does something else', () => {
  expectFailure(
    withRootManifest(json => {
      json.scripts.postinstall = 'echo hello';
    }),
    /`postinstall` must run `prisma generate`/
  );
});

test('P9 accepts a postinstall that wraps the generate step', () => {
  expectClean(
    withRootManifest(json => {
      json.scripts.postinstall = 'pnpm --filter @fixture/api exec prisma generate && node tools/after.mjs';
    })
  );
});

test('P9 is not satisfied by the hook on a workspace manifest', () => {
  // The shape that looked right and never ran: pnpm executes lifecycle scripts
  // for the root project, not for workspace projects.
  expectFailure(
    withRootManifest(json => {
      delete (json.scripts as Record<string, unknown>).postinstall;
    }),
    /`postinstall` must run `prisma generate`/
  );
});

// ---------------------------------------------------------------------------
// P7/P8 — the Dockerfile spellings and export shapes a second review found.
//
// Every case here was confirmed against the real repository's Dockerfile and
// manifest before the rules were widened.
// ---------------------------------------------------------------------------

test('P7 allows a wildcard that blocks a subtree rather than publishing one', () => {
  // `"./internal/*": null` refuses everything under `./internal`. Rejecting it
  // was a false positive: it draws the boundary the rule wants.
  expectClean(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './internal/*': null,
        './package.json': './package.json',
      };
    })
  );
});

test('P7 allows a wildcard whose every condition is null', () => {
  expectClean(
    withApiManifest(json => {
      json.exports = {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './internal/*': { types: null, default: null },
      };
    })
  );
});

test('P7 still rejects a wildcard that resolves to something', () => {
  for (const target of ['./*', './dist/*']) {
    expectFailure(
      withApiManifest(json => {
        json.exports = {
          '.': { types: './dist/index.d.ts', default: './dist/index.js' },
          './*': target,
        };
      }),
      /publishes by pattern/
    );
  }
});

test('P8 catches `COPY . .`, which carries the whole build context', () => {
  expectFailure(webDockerfile('COPY . .\n'), /copies `\/`, which overlaps/);
});

test('P8 is case-insensitive, as Dockerfile instructions are', () => {
  expectFailure(
    webDockerfile('copy --from=builder /app/apps/api/src ./apps/api/src\n'),
    /overlaps `apps\/api\/src`/
  );
});

test('P8 strips whatever WORKDIR the builder declared, not a hardcoded /app', () => {
  expectFailure(
    withFile(
      'apps/web/Dockerfile',
      `FROM node:24-alpine AS base
FROM base AS builder
WORKDIR /srv
COPY . .
FROM base AS runner
COPY --from=builder /srv/apps/api/src ./apps/api/src
`
    ),
    /overlaps `apps\/api\/src`/
  );
});

test('P8 reads a named runner that is not the last stage', () => {
  // A Dockerfile may declare a debug or test target after the runtime stage.
  // Reading only the last stage would then check the wrong one entirely.
  expectFailure(
    withFile(
      'apps/web/Dockerfile',
      `FROM node:24-alpine AS base
FROM base AS builder
WORKDIR /app
COPY . .
FROM base AS runner
COPY --from=builder /app/apps/api/src ./apps/api/src
FROM base AS debug
RUN echo debug
`
    ),
    /runtime stage `runner` copies/
  );
});

test('P8 leaves a builder stage alone even when a later stage is named runner', () => {
  expectClean(
    withFile(
      'apps/web/Dockerfile',
      `FROM node:24-alpine AS base
FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm --filter @luke/api build
FROM base AS runner
COPY --from=builder /app/apps/web/.next ./apps/web/.next
FROM base AS debug
RUN echo debug
`
    )
  );
});

// ---------------------------------------------------------------------------
// P10 — workspace dependency direction (layer + runtime capability policy)
// ---------------------------------------------------------------------------

/** A copy of the baseline whose manifest at `path` has been edited. */
function withManifest(path: string, edit: (json: Record<string, unknown>) => void): RepoFiles {
  const json = JSON.parse(VALID_REPO[path]) as Record<string, unknown>;
  edit(json);
  return withFile(path, JSON.stringify(json, null, 2));
}

function addDep(group: string, name: string, spec = 'workspace:*') {
  return (json: Record<string, unknown>): void => {
    json[group] = { ...((json[group] as Record<string, string> | undefined) ?? {}), [name]: spec };
  };
}

test('P10 fails when core declares the api: upward, whether or not anything imports it', () => {
  expectFailure(withManifest('packages/core/package.json', addDep('dependencies', '@fixture/api')), /points upward/);
});

test('P10 fails on an upward devDependency too — a type edge is still an edge', () => {
  expectFailure(withManifest('packages/core/package.json', addDep('devDependencies', '@fixture/api')), /points upward/);
});

test('P10 fails on a sideways edge between peers (nav → calendar)', () => {
  expectFailure(withManifest('packages/nav/package.json', addDep('dependencies', '@fixture/calendar')), /points sideways/);
});

test('P10 fails when a browser package takes a node library at runtime (web → calendar)', () => {
  expectFailure(withManifest('apps/web/package.json', addDep('dependencies', '@fixture/calendar')), /runtime dependency/);
});

test('P10 fails when web takes the api at runtime', () => {
  expectFailure(withManifest('apps/web/package.json', addDep('dependencies', '@fixture/api')), /runtime dependency/);
});

test('P10 accepts web taking the api as a devDependency: the types-only edge', () => {
  expectClean(withManifest('apps/web/package.json', addDep('devDependencies', '@fixture/api')));
});

test('P10 accepts a lower universal package at runtime (nav → core is the baseline)', () => {
  expectClean(VALID_REPO);
});

test('P10 accepts any workspace: protocol form, not only workspace:*', () => {
  expectClean(withManifest('packages/nav/package.json', addDep('dependencies', '@fixture/core', 'workspace:^')));
});

test('P10 fails when the root declares a workspace under dependencies', () => {
  expectFailure(
    withRootManifest(json => {
      (json as Record<string, unknown>).dependencies = { '@fixture/api': 'workspace:*' };
    }),
    /is tooling but declares/
  );
});

test('P10 accepts the root declaring a workspace under devDependencies', () => {
  expectClean(
    withRootManifest(json => {
      (json as Record<string, unknown>).devDependencies = { ...json.devDependencies, '@fixture/api': 'workspace:*' };
    })
  );
});

test('P10 fails on a self-dependency', () => {
  expectFailure(withManifest('packages/core/package.json', addDep('dependencies', '@fixture/core')), /declares itself/);
});

test('P10 fails when a workspace sits in both dependencies and devDependencies', () => {
  expectFailure(
    withManifest('apps/api/package.json', addDep('devDependencies', '@fixture/core')),
    /both `dependencies` and `devDependencies`/
  );
});

test('P10 fails closed on a tracked manifest with no policy row', () => {
  expectFailure(
    withFile('packages/rogue/package.json', JSON.stringify({ name: '@fixture/rogue', private: true })),
    /no row in `WORKSPACE_POLICY`/
  );
});

test('P10 fails closed on a policy row whose manifest is no longer tracked', () => {
  expectFailure(withoutFile('packages/calendar/package.json'), /no such manifest is tracked/);
});

test('P10 fails on a workspace: link to a name no tracked manifest has', () => {
  expectFailure(
    withManifest('apps/api/package.json', addDep('dependencies', '@fixture/ghost')),
    /no single tracked manifest has that name/
  );
});

test('P10 fails when a tracked workspace is declared with a semver range instead of workspace:', () => {
  expectFailure(
    withManifest('apps/api/package.json', addDep('dependencies', '@fixture/core', '^1.0.0')),
    /instead of the `workspace:` protocol/
  );
});

test('P10 leaves external packages with semver ranges alone', () => {
  expectClean(withManifest('apps/api/package.json', addDep('dependencies', 'left-pad', '^1.3.0')));
});

test('P10 fails closed on a workspace under peerDependencies', () => {
  expectFailure(withManifest('apps/web/package.json', addDep('peerDependencies', '@fixture/core')), /has no meaning for a workspace edge/);
});

test('P10 fails closed on a workspace under optionalDependencies', () => {
  expectFailure(withManifest('apps/api/package.json', addDep('optionalDependencies', '@fixture/nav')), /has no meaning for a workspace edge/);
});

test('P10 fails closed on a workspace: spec under peerDependencies even for an unknown name', () => {
  expectFailure(withManifest('apps/web/package.json', addDep('peerDependencies', '@fixture/ghost')), /has no meaning for a workspace edge/);
});

test('P10 leaves an external peerDependency alone', () => {
  expectClean(withManifest('apps/web/package.json', addDep('peerDependencies', 'react', '^19.0.0')));
});

test('P10 fails closed on a classified manifest with no name', () => {
  expectFailure(withManifest('packages/nav/package.json', json => { delete json.name; }), /has no `name`/);
});

test('P10 fails closed on a classified manifest with an empty name', () => {
  expectFailure(withManifest('packages/nav/package.json', json => { json.name = ''; }), /has no `name`/);
});

test('P10 reports every manifest that shares a name, not only the second one found', () => {
  const problems = checkPlatformIntegrity(
    repo(withManifest('packages/nav/package.json', json => { json.name = '@fixture/calendar'; }))
  );
  const reported = problems.filter(p => /is also the name of/.test(p.message)).map(p => p.file).sort();
  assert.deepEqual(reported, ['packages/calendar/package.json', 'packages/nav/package.json']);
});

test('P10 resolves no edge through a duplicated name, so a dependant of it is reported too', () => {
  const problems = checkPlatformIntegrity(
    repo({
      ...withManifest('packages/nav/package.json', json => { json.name = '@fixture/calendar'; }),
      'apps/api/package.json': JSON.stringify(
        { ...JSON.parse(VALID_REPO['apps/api/package.json']), dependencies: { ...JSON.parse(VALID_REPO['apps/api/package.json']).dependencies, '@fixture/calendar': 'workspace:*' } },
        null,
        2
      ),
    })
  );
  assert.ok(problems.some(p => p.file === 'apps/api/package.json' && /no single tracked manifest has that name/.test(p.message)), problems.map(p => `${p.file}: ${p.message}`).join('\n'));
});
