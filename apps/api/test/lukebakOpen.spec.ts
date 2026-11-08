/**
 * `scripts/lukebak-open.mjs`, the offline reader of a `.lukebak` export (#109), against a package
 * built with the API's own export code. It streams the body instead of reading the whole file, never
 * touches an existing output, and leaves no output behind when anything fails — the final GCM
 * authentication included.
 */

import { spawnSync } from 'child_process';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { gzipSync } from 'zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BackupExportHeader } from '@luke/core';

import { createBackupCipher, generateDek, wrapDekWithPassphrase } from '../src/lib/backup/crypto';
import { encodeExportHeader } from '../src/lib/backup/exportFormat';

const SCRIPT = join(import.meta.dirname, '..', '..', '..', 'scripts', 'lukebak-open.mjs');
const PASSPHRASE = 'correct horse battery staple';

let dir: string;
let tar: Buffer;
let header: Buffer;
let body: Buffer;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lukebak-open-'));
  tar = randomBytes(200_000);
  const dek = generateDek();
  const { iv, cipher } = createBackupCipher(dek);
  body = Buffer.concat([cipher.update(gzipSync(tar)), cipher.final()]);
  const exportHeader: BackupExportHeader = {
    version: 1,
    backupId: randomUUID(),
    scope: 'DB',
    algorithm: 'aes-256-gcm',
    kdf: 'argon2id',
    passphraseWrapped: await wrapDekWithPassphrase(dek, PASSPHRASE),
    bodyIvHex: iv.toString('hex'),
    bodyAuthTagHex: cipher.getAuthTag().toString('hex'),
    checksumSha256: createHash('sha256').update(body).digest('hex'),
    sizeBytesEncrypted: String(body.length),
    appVersion: null,
    schemaMigrationName: null,
    createdAt: new Date().toISOString(),
  };
  header = encodeExportHeader(exportHeader);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes `bytes` as a package and opens it into `out` (in `dir` unless absolute), the passphrase on stdin. */
function open(name: string, bytes: Buffer, out = `${name}.tar`, passphrase = PASSPHRASE) {
  const file = join(dir, `${name}.lukebak`);
  writeFileSync(file, bytes);
  const outPath = resolve(dir, out);
  const run = spawnSync(process.execPath, [SCRIPT, file, outPath], { input: `${passphrase}\n`, encoding: 'utf8' });
  return { status: run.status, stderr: run.stderr, outPath };
}

describe('lukebak-open', () => {
  it('writes the original tar with the right passphrase', () => {
    const run = open('good', Buffer.concat([header, body]));

    expect(run.status).toBe(0);
    expect(readFileSync(run.outPath).equals(tar)).toBe(true);
  });

  it('refuses a wrong passphrase before creating any output', () => {
    const run = open('wrong', Buffer.concat([header, body]), undefined, 'not the passphrase');

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/passphrase/i);
    expect(existsSync(run.outPath)).toBe(false);
  });

  it('removes its output when the body fails authentication', () => {
    const tampered = Buffer.from(body);
    tampered[tampered.length - 1] ^= 0xff;
    const run = open('tampered', Buffer.concat([header, tampered]));

    expect(run.status).toBe(1);
    expect(existsSync(run.outPath)).toBe(false);
  });

  it.each([
    ['a body shorter than the header says', () => Buffer.concat([header, body.subarray(0, body.length - 10)])],
    ['a header cut short', () => header.subarray(0, 20)],
    ['a header length out of bounds', () => Buffer.from([0xff, 0xff, 0xff, 0xff, 0x7b])],
  ])('refuses %s, creating no output', (_case, bytes) => {
    const run = open(`cut-${randomUUID()}`, bytes());

    expect(run.status).toBe(1);
    expect(existsSync(run.outPath)).toBe(false);
  });

  it('refuses a damaged header before asking for the passphrase', () => {
    const json = JSON.parse(header.subarray(4).toString('utf8'));
    const damaged = Buffer.from(JSON.stringify({ ...json, passphraseWrapped: {} }), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(damaged.length, 0);
    const run = open('damaged', Buffer.concat([length, damaged, body]));

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/header is damaged/);
    expect(existsSync(run.outPath)).toBe(false);
  });

  it('never overwrites an existing output', () => {
    writeFileSync(join(dir, 'present.tar'), 'keep me');
    const run = open('present', Buffer.concat([header, body]));

    expect(run.status).toBe(1);
    expect(readFileSync(run.outPath, 'utf8')).toBe('keep me');
  });

  // Root ignores directory permissions, so the case cannot be staged that way there.
  it.skipIf(process.getuid?.() === 0)('exits 1 with a message when the output cannot be written', () => {
    const readOnly = join(dir, 'read-only');
    mkdirSync(readOnly);
    chmodSync(readOnly, 0o500);
    const run = open('unwritable', Buffer.concat([header, body]), join(readOnly, 'out.tar'));
    chmodSync(readOnly, 0o700);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/out\.tar/);
    expect(existsSync(run.outPath)).toBe(false);
  });
});
