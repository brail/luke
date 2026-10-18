/**
 * Creating the master key on a fresh home is safe when several processes do it at once.
 *
 * `getMasterKey` used to write `~/.luke/secret.key` in place: a process reading it at the wrong
 * moment found it empty and every derived secret failed (seen as "Unable to derive secret for
 * purpose: luke:download-token" in parallel CI test workers), and two processes could each write
 * their own key. The key is now published atomically, first process wins.
 */

import { spawn } from 'child_process';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { describe, expect, it } from 'vitest';

const SOURCE = pathToFileURL(join(fileURLToPath(new URL('.', import.meta.url)), '..', 'secrets.server.ts')).href;

/** A separate Node process deriving a secret from the key under `home`. */
function deriveInChild(home: string): Promise<string> {
  const script = `import(${JSON.stringify(SOURCE)}).then(m => process.stdout.write(m.deriveSecret('probe')))`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '-e', script], { env: { ...process.env, HOME: home } });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('close', code => (code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))));
  });
}

describe('getMasterKey on a fresh home', () => {
  it('gives every concurrent process the same key and leaves no temporary file', async () => {
    // The race is a narrow window, so several rounds of many processes; each round a fresh home.
    for (let round = 0; round < 3; round++) {
      const home = mkdtempSync(join(tmpdir(), 'luke-master-key-'));
      try {
        const secrets = await Promise.all(Array.from({ length: 24 }, () => deriveInChild(home)));

        expect(new Set(secrets).size).toBe(1);
        expect(readdirSync(join(home, '.luke'))).toEqual(['secret.key']);
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  }, 60_000);
});
