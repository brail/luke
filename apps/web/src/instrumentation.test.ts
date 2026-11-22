/**
 * The apps/web server-start hook refuses a production start with TLS verification switched off,
 * warns elsewhere, and does nothing outside the Node.js runtime (#283, ADR-046).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { register } from './instrumentation';

import type { MockInstance } from 'vitest';

class ExitCalled extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

let exit: MockInstance<typeof process.exit>;
let error: MockInstance<typeof console.error>;
let warn: MockInstance<typeof console.warn>;

const stub = (nodeEnv: string, runtime: string | undefined, value: string | undefined) => {
  vi.stubEnv('NODE_ENV', nodeEnv);
  vi.stubEnv('NEXT_RUNTIME', runtime);
  vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', value);
};

beforeEach(() => {
  exit = vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new ExitCalled(code);
  });
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('register', () => {
  it('exits 1 in production with NODE_TLS_REJECT_UNAUTHORIZED=0, naming the variable', async () => {
    stub('production', 'nodejs', '0');
    await expect(register()).rejects.toThrow(ExitCalled);
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[env-policy] NODE_TLS_REJECT_UNAUTHORIZED=0'));
  });

  it.each(['development', 'test'])('warns once and starts outside production (NODE_ENV=%s)', async nodeEnv => {
    stub(nodeEnv, 'nodejs', '0');
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NODE_TLS_REJECT_UNAUTHORIZED=0'));
  });

  it.each([undefined, '1'])('starts silently in production when the variable is %j', async value => {
    stub('production', 'nodejs', value);
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([undefined, 'edge'])('does nothing outside the Node.js runtime (NEXT_RUNTIME=%s)', async runtime => {
    stub('production', runtime, '0');
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
