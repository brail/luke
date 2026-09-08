/**
 * The web build's release-identity contract.
 *
 * `NEXT_PUBLIC_APP_VERSION` reaches the client bundle from the Docker `ARG APP_VERSION`
 * (`apps/web/Dockerfile`). `.github/workflows/release.yml` feeds that argument the provenance
 * gate's normalized output when it builds the release images; `.github/workflows/ci.yml`'s
 * `Build (web)` step feeds it the `dev` sentinel instead, so an ordinary CI build claims no release.
 *
 * Both of those paths were dead for as long as `next.config.js` declared an `env:` block: Next
 * spreads a config `env` *after* the real `NEXT_PUBLIC_*` environment, so the block shadowed the
 * Dockerfile's `ENV` and baked `npm_package_version` — the workspace manifest number — into the
 * bundle instead. Two builds of the same commit disagreed as a result: the Docker build inlined
 * the manifest version, while the CI build inlined `dev`, because turbo's strict env mode filters
 * `npm_package_version` out of the task environment entirely.
 *
 * This lives here rather than in the web tiers because it is a build-configuration invariant, and
 * because no component test can decide it: a component reads a value the bundler already inlined,
 * so restoring the block need not turn any rendering test red.
 *
 * Run: `pnpm test:tools`
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

import { REPO_ROOT } from './lib/report';

const CONFIG_PATH = join(REPO_ROOT, 'apps/web/next.config.js');

test('next.config.js defines no env.NEXT_PUBLIC_APP_VERSION, so the Dockerfile ENV is what wins', () => {
  // `createRequire` is given a path rather than `import.meta.url`: this file compiles to CommonJS
  // under `tools/tsconfig.json`, where the meta-property is not available.
  const require = createRequire(join(REPO_ROOT, 'package.json'));
  // Evaluated, not grepped: a re-added block is caught however it is spelled.
  const config: unknown = require(CONFIG_PATH);
  assert.ok(
    typeof config === 'object' && config !== null,
    'next.config.js did not export a config object'
  );

  // The invariant is narrow: `env.NEXT_PUBLIC_APP_VERSION` must be absent. A config `env` object
  // is not forbidden and unrelated future entries in it are fine — only this one key is, because
  // only this one shadows a value the Dockerfile injects. No `env` at all satisfies that trivially,
  // which is why there is nothing left to check in that case.
  //
  // Narrowed by `in` and a runtime shape check rather than by an assertion: the value crosses a
  // `require` boundary, so its type is genuinely unknown here and asserting one would be asserting
  // the very thing under test.
  if (!('env' in config)) return;

  const env: unknown = config.env;
  assert.ok(
    typeof env === 'object' && env !== null,
    'next.config.js exports an `env` that is not an object — Next would reject it, and this ' +
      'contract cannot read it'
  );
  assert.ok(
    !('NEXT_PUBLIC_APP_VERSION' in env),
    'next.config.js defines env.NEXT_PUBLIC_APP_VERSION, which shadows the value the ' +
      'Dockerfile injects from the release tag'
  );
});

test('next.config.js does not read npm_package_version, which no container sets', () => {
  // Textual, so a block that reads the manifest version under some other key is still caught.
  const source = readFileSync(CONFIG_PATH, 'utf-8');
  assert.ok(
    !source.includes('npm_package_version'),
    'next.config.js reads npm_package_version — the API container never sets it, and the web ' +
      'Docker build only sets it because pnpm runs the build script'
  );
});
