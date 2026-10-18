/**
 * The compile-time half of AppConfig write authority.
 *
 * A type error cannot be asserted at runtime, so the assertions here are the `@ts-expect-error`
 * comments themselves: each one fails `tsc` if the error it expects stops happening. The file is
 * inside `tsconfig.test.json`'s `include`, so `pnpm typecheck:test` — and CI with it — is the gate.
 *
 * What this pins is the property the task set out to get: changing a key in `AppConfigRegistry`
 * must break the build at the call site that *writes* it, not at the first read in production.
 * Deleting a key, or renaming it, turns the corresponding block below red.
 */

import { describe, it, expect } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { saveConfig } from '../src/lib/configManager';


// Never dereferenced: every `saveConfig` below sits inside a `void (() => …)` that is compiled and
// never called. A real client would mean a database for a test that only asks tsc a question.
const prisma = undefined as unknown as PrismaClient;

describe('saveConfig only accepts registered keys', () => {
  it('rejects an unregistered key at compile time', () => {
    // Well-formed and under an allowed prefix. Before the key was typed, this compiled and wrote a
    // row that no reader in the codebase could ever ask for.
    // @ts-expect-error — 'app.whatever' is not an AppConfigKey
    void (() => saveConfig(prisma, 'app.whatever', 'x'));

    // A key assembled from a plain `string` cannot be checked, and is refused rather than trusted.
    const provider: string = 'smb';
    // @ts-expect-error — `storage.${string}` is not assignable to AppConfigKey
    void (() => saveConfig(prisma, `storage.${provider}`, '{}'));

    expect(true).toBe(true);
  });

  it('accepts a registered key, including the two built from an enum', () => {
    // No `@ts-expect-error`: these must keep compiling. `storage.${provider}` narrows because
    // `provider` is the two-value enum the tRPC input declares, not an open string.
    const provider = 'drive' as 'smb' | 'drive';
    void (() => saveConfig(prisma, 'security.password.minLength', '12'));
    void (() => saveConfig(prisma, `storage.${provider}`, '{}'));

    expect(true).toBe(true);
  });
});
