/**
 * `runCommand` / `runPgBinary` share `spawnAndCapture` (#109): stdout is discarded, so a child that
 * writes a lot there (`pg_restore --list`, the table of contents) cannot fill an unread pipe and
 * block; stderr is kept only up to what the error message shows.
 */

import { describe, expect, it } from 'vitest';

import { runCommand } from '../src/lib/backup/pgConnection';

describe('spawnAndCapture', () => {
  it('completes a child that writes more than a pipe holds to stdout', async () => {
    await expect(
      runCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(2 * 1024 * 1024))"])
    ).resolves.toBeUndefined();
  }, 10_000);

  it('reports the start of stderr, bounded, on a non-zero exit', async () => {
    const run = runCommand(
      process.execPath,
      ['-e', "process.stderr.write('first line\\n' + 'y'.repeat(2 * 1024 * 1024)); process.exit(3)"],
      {},
      100
    );

    await expect(run).rejects.toThrow(/exited with code 3: first line/);
    await expect(run).rejects.toSatisfy((error: Error) => error.message.length < 200);
  });
});
