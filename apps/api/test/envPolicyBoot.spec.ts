/**
 * The env policy guards the real start of the API server, not only its own function (#283): a
 * production boot with `NODE_TLS_REJECT_UNAUTHORIZED=0` exits 1 naming the variable. No database is
 * needed: the guard runs before `checkBootstrapDependencies` connects.
 */

import { spawn } from 'child_process';
import { join } from 'path';

import { describe, expect, it, onTestFinished } from 'vitest';

const API_DIR = join(__dirname, '..');

describe('env policy at server start', () => {
  it('refuses a production start with TLS verification switched off', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: API_DIR,
      env: {
        // nosemgrep: luke-no-direct-env -- the child inherits the environment (PATH); the boot settings are overridden
        ...process.env,
        NODE_ENV: 'production',
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        LUKE_TRUSTED_PROXY_CIDR: '172.30.0.0/16',
        // Closed port: if the guard did not stop the boot, the connection would fail with another message.
        DATABASE_URL: 'postgresql://luke:unused@127.0.0.1:1/unused',
        OTEL_ENABLED: 'false',
      },
    });
    // A regression that let the boot go on would leave the server running past the timeout.
    onTestFinished(() => {
      child.kill();
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

    const code = await new Promise<number | null>(resolve => child.on('exit', resolve));

    expect(code).toBe(1);
    expect(output).toContain('[env-policy]');
    expect(output).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate verification');
  }, 30_000);
});
