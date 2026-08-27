/**
 * Offline reader for a Luke `.lukebak` backup export package.
 *
 *   pnpm backup:open <file.lukebak> <passphrase> [out.tar]
 *
 * Decrypts an export package to a plain tar containing `db.dump` (pg_dump custom format) and,
 * for a DB_AND_FILES backup, `files/<bucket>/<key>`. Inspect with `tar tvf`, then `pg_restore`.
 *
 * Deliberately standalone: no build step, no database, no @luke/core import — this has to run on
 * a bare machine in the disaster-recovery case where the only surviving artifact is the .lukebak
 * file and its passphrase. The cost of that independence is a hand-copy of three constants from
 * `apps/api/src/lib/backup/crypto.ts` and `apps/api/src/lib/password.ts` (the Argon2id tuning,
 * AES-256-GCM, the 16-byte tag). Drift there is safe in the sense that matters: a mismatch fails
 * loudly on the GCM auth tag rather than producing wrong plaintext.
 *
 * The one thing not vendored is `argon2` itself (native module), resolved out of the repo's
 * node_modules. Set LUKE_API_DIR to point elsewhere when running outside a checkout.
 */
import { createDecipheriv } from 'crypto';
import { createRequire } from 'module';
import { createWriteStream, readFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';

const apiDir = process.env.LUKE_API_DIR ?? join(import.meta.dirname, '..', 'apps', 'api');
const argon2 = createRequire(`${apiDir}/package.json`)('argon2');

const [file, passphrase, out = 'backup.tar'] = process.argv.slice(2);
if (!file || !passphrase) {
  console.error('usage: pnpm backup:open <file.lukebak> <passphrase> [out.tar]');
  process.exit(1);
}

const buf = readFileSync(file);
const headerLength = buf.readUInt32BE(0);
const header = JSON.parse(buf.subarray(4, 4 + headerLength).toString('utf8'));
const body = buf.subarray(4 + headerLength);

console.error('--- header ---');
console.error(JSON.stringify(header, null, 2));
console.error(`--- body: ${body.length} bytes (header says ${header.sizeBytesEncrypted}) ---`);
if (String(body.length) !== String(header.sizeBytesEncrypted)) {
  console.error('WARNING: body size does not match the header — file is truncated.');
}

// Same Argon2id tuning as ARGON2_OPTIONS in apps/api/src/lib/password.ts.
const key = await argon2.hash(passphrase, {
  type: argon2.argon2id,
  memoryCost: 2 ** 16,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
  raw: true,
  salt: Buffer.from(header.passphraseWrapped.saltHex, 'hex'),
});

// Unwrap the DEK. Raw 32 bytes here, unlike the master-key path (wrapDek) which wraps the hex
// string — see wrapDekWithPassphrase in apps/api/src/lib/backup/crypto.ts.
const dekDecipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.passphraseWrapped.ivHex, 'hex'), { authTagLength: 16 });
dekDecipher.setAuthTag(Buffer.from(header.passphraseWrapped.authTagHex, 'hex'));
const dek = Buffer.concat([
  dekDecipher.update(Buffer.from(header.passphraseWrapped.ciphertextHex, 'hex')),
  dekDecipher.final(),
]);

// Decrypt + gunzip the body into a plain tar.
const bodyDecipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(header.bodyIvHex, 'hex'), { authTagLength: 16 });
bodyDecipher.setAuthTag(Buffer.from(header.bodyAuthTagHex, 'hex'));
await pipeline(Readable.from(body), bodyDecipher, createGunzip(), createWriteStream(out));
console.error(`OK → ${out}   (tar tvf ${out})`);
