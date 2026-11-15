/**
 * The display rule for the release identity, pinned at its three real values.
 *
 * `dev` is not hypothetical: it is the `ARG APP_VERSION=dev` default of both Dockerfiles and the
 * value the CI web build sets, so a helper that prefixed unconditionally would ship `vdev`.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import { appVersionLabel } from './appVersion';

const ORIGINAL = process.env.NEXT_PUBLIC_APP_VERSION;

const set = (value: string | undefined) => {
  if (value === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION;
  else process.env.NEXT_PUBLIC_APP_VERSION = value;
};

beforeEach(() => set(undefined));
afterAll(() => set(ORIGINAL));

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
