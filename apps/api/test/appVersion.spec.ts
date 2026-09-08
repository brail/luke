/**
 * The release identity the API reports.
 *
 * `APP_VERSION` arrives from the provenance gate already normalized (`3.0.0-rc.1`, no leading `v`),
 * so these tests pin two things that used to be wrong at the same time: the value passes through
 * untouched, and the one display surface that adds a `v` adds exactly one.
 *
 * The route-level assertions below are deliberately source contracts rather than HTTP tests:
 * `server.ts` exports no builder, so an HTTP test would have to exercise the parallel stub routes in
 * `test/helpers.ts` (which return a hardcoded `'test'`) and would prove nothing about the real
 * handlers. The behaviour itself is proved by the module tests above them.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { appVersion, releaseIdentity } from '../src/lib/appVersion';

const SRC = join(import.meta.dirname, '..', 'src');
const read = (...segments: string[]) => readFileSync(join(SRC, ...segments), 'utf-8');

/** The one shape the xlsx `manager` property may take, asserted against the source. */
function assert_manager(source: string) {
  const occurrences = source.match(/manager: `Luke - v\$\{appVersion\(\)\}`,/g) ?? [];
  expect(occurrences).toHaveLength(2);
  expect(source).not.toMatch(/Luke - vv/);
  expect(source).not.toContain('APP_VERSION');
}

const ORIGINAL = process.env.APP_VERSION;

const setAppVersion = (value: string | undefined) => {
  if (value === undefined) delete process.env.APP_VERSION;
  else process.env.APP_VERSION = value;
};

beforeEach(() => setAppVersion(undefined));
afterAll(() => setAppVersion(ORIGINAL));

describe('releaseIdentity', () => {
  it('returns the normalized value the provenance gate emits, unchanged', () => {
    setAppVersion('3.0.0-rc.1');
    expect(releaseIdentity()).toBe('3.0.0-rc.1');
  });

  it('returns null when the build carries no release identity', () => {
    expect(releaseIdentity()).toBeNull();
  });

  it('treats an empty or blank value as absent, not as a second spelling of it', () => {
    setAppVersion('');
    expect(releaseIdentity()).toBeNull();
    setAppVersion('   ');
    expect(releaseIdentity()).toBeNull();
  });

  it('never strips or adds a v — the gate already normalized it', () => {
    setAppVersion('3.0.0-rc.1');
    expect(releaseIdentity()).not.toMatch(/^v/);
  });
});

describe('appVersion', () => {
  it('is the release identity when there is one', () => {
    setAppVersion('3.0.0-rc.1');
    expect(appVersion()).toBe('3.0.0-rc.1');
  });

  it('falls back to dev, never to a version number nobody released', () => {
    expect(appVersion()).toBe('dev');
    expect(appVersion()).not.toBe('0.1.0');
  });

  it('reads the environment per call, so a running process is never stale', () => {
    setAppVersion('3.0.0-rc.1');
    expect(appVersion()).toBe('3.0.0-rc.1');
    setAppVersion('3.0.0');
    expect(appVersion()).toBe('3.0.0');
  });
});

describe('wiring contracts over the production sources (no route or workbook is executed)', () => {
  it('no source reads npm_package_version, which the container never sets', () => {
    for (const file of [
      ['server.ts'],
      ['instrument.ts'],
      ['routers', 'public.ts'],
      ['routers', 'sales.ts'],
      ['lib', 'backup', 'dumpPipeline.ts'],
    ]) {
      expect(read(...file), file.join('/')).not.toContain('npm_package_version');
    }
  });

  it('the health and root routes report the release identity, not a hardcoded 0.1.0', () => {
    const server = read('server.ts');
    expect(server).not.toContain("'0.1.0'");
    expect(server.match(/version: appVersion\(\),/g)).toHaveLength(2);
  });

  it('both xlsx call sites use the single-v template', () => {
    // A wiring contract, not a workbook test: it reads the two literals in `sales.ts` and proves
    // they are the single-`v` template fed by `appVersion()`. It does not build a workbook and does
    // not inspect one — a second `v` added back here is the exact regression that shipped
    // `Luke - vv2.1.4`, and reading the source is what sees it.
    assert_manager(read('routers', 'sales.ts'));
  });

  it('the OTel resource reports it too', () => {
    expect(read('instrument.ts')).toContain('[ATTR_SERVICE_VERSION]: appVersion(),');
  });

  it('the version module stays a zero-import leaf, as its header requires', () => {
    // `instrument.ts` is loaded through `node --require ./dist/instrument.js` before the server and
    // before the OpenTelemetry instrumentations register, so anything this module imported would be
    // pulled into the process earlier than it is today. The header says so; this makes it fail.
    const source = read('lib', 'appVersion.ts');
    const imports = source.match(/^\s*import[\s{'"]/gm) ?? [];
    expect(imports).toHaveLength(0);
  });

  it('the backup pipeline keeps absence as null rather than inventing a dev identity', () => {
    // BackupRecord.appVersion and the .lukebak sidecar are persisted: a stored null means "no
    // release identity", and appVersion()'s 'dev' fallback would quietly destroy that distinction.
    const dump = read('lib', 'backup', 'dumpPipeline.ts');
    expect(dump).toContain('const appVersion = releaseIdentity();');
    expect(dump).not.toContain('appVersion()');
  });
});
