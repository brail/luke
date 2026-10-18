/**
 * SIGTERM runs the server's shutdown, `onClose` hooks included, even with `instrument.ts` preloaded
 * and telemetry off: the instrumentation registers no signal handler of its own that would exit
 * first (#87).
 */

import { spawn } from 'child_process';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const API_DIR = join(__dirname, '..');

describe('graceful shutdown', () => {
  it('runs the onClose hooks on SIGTERM and exits 0', async () => {
    // Node itself with tsx's loader, not the tsx CLI: the CLI relays a signal to a child process and
    // kills it outright if that child does not acknowledge the signal within 30 ms, which a busy
    // test run can exceed. Production runs `node` directly.
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--import', './src/instrument.ts', 'test/fixtures/shutdownChild.ts'],
      // nosemgrep: luke-no-direct-env -- the child inherits the environment (PATH); only OTel is switched off
      { cwd: API_DIR, env: { ...process.env, OTEL_ENABLED: 'false' } }
    );
    let stdout = '';
    let signalled = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!signalled && stdout.includes('ready\n')) {
        signalled = true;
        child.kill('SIGTERM');
      }
    });

    const code = await new Promise<number | null>(resolve => child.on('exit', resolve));

    expect(stdout).toContain('onClose ran');
    expect(code).toBe(0);
  }, 30_000);
});
