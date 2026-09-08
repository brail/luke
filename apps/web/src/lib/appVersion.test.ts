/**
 * The display rule for the release identity, pinned at its three real values.
 *
 * `dev` is not hypothetical: it is the `ARG APP_VERSION=dev` default of both Dockerfiles and the
 * value the CI web build sets, so a helper that prefixed unconditionally would ship `vdev`.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { appVersionLabel, appVersionText } from './appVersion';

const ORIGINAL = process.env.NEXT_PUBLIC_APP_VERSION;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

const set = (value: string | undefined) => {
  if (value === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
  else process.env.NEXT_PUBLIC_APP_VERSION = value;
};

const setNodeEnv = (value: string) => {
  // NODE_ENV is readonly in the Next type surface but a plain string at runtime, and this suite
  // needs both of its values.
  (process.env as Record<string, string>).NODE_ENV = value;
};

beforeEach(() => {
  set(undefined);
  setNodeEnv('production');
});
afterAll(() => {
  set(ORIGINAL);
  setNodeEnv(ORIGINAL_NODE_ENV ?? 'test');
});

describe('appVersionLabel', () => {
  it('renders nothing when the build carries no release identity', () => {
    expect(appVersionLabel()).toBeNull();
  });

  it('treats a blank value as absent', () => {
    set('   ');
    expect(appVersionLabel()).toBeNull();
  });

  it('renders the dev sentinel bare — never vdev', () => {
    set('dev');
    expect(appVersionLabel()).toBe('dev');
    expect(appVersionLabel()).not.toMatch(/^v/);
  });

  it('prefixes exactly one v for a released version', () => {
    set('3.0.0-rc.1');
    expect(appVersionLabel()).toBe('v3.0.0-rc.1');
    set('3.0.0');
    expect(appVersionLabel()).toBe('v3.0.0');
  });

  it('never doubles the v if the value ever arrives with one', () => {
    // The gate normalizes, so this should not happen; if it regresses, one v is still wrong but
    // `vv3.0.0` is the shape that reached production last time.
    set('v3.0.0');
    expect(appVersionLabel()).not.toMatch(/^vv/);
  });
});

describe('appVersionText', () => {
  it('says nothing at all in a production build with no release identity', () => {
    expect(appVersionText()).toBeNull();
  });

  it('is the version alone in a production build that has one', () => {
    set('3.0.0-rc.1');
    expect(appVersionText()).toBe('v3.0.0-rc.1');
  });

  it('still marks development when the build carries no release identity', () => {
    // `pnpm dev` sets no NEXT_PUBLIC_APP_VERSION. Nesting the marker inside a version guard would
    // drop it in exactly the environment it exists for.
    setNodeEnv('development');
    expect(appVersionText()).toBe('development');
  });

  it('composes both when a development build does carry one', () => {
    setNodeEnv('development');
    set('3.0.0-rc.1');
    expect(appVersionText()).toBe('v3.0.0-rc.1 · development');
  });

  it('never renders the dev sentinel with a v, composed or alone', () => {
    set('dev');
    expect(appVersionText()).toBe('dev');
    setNodeEnv('development');
    expect(appVersionText()).toBe('dev · development');
    expect(appVersionText()).not.toMatch(/vdev/);
  });
});
