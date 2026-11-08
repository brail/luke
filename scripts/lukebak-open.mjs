/**
 * Offline reader for a Luke `.lukebak` backup export package.
 *
 *   pnpm backup:open <file.lukebak> [out.tar]
 *
 * Prompts for the passphrase without echoing it, or reads the first line of stdin when stdin is
 * not a terminal. Never as an argument: it would be kept in the shell history and shown by `ps`.
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
import { unlinkSync } from 'fs';
import { open, unlink } from 'fs/promises';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';

const apiDir = process.env.LUKE_API_DIR ?? join(import.meta.dirname, '..', 'apps', 'api');
const argon2 = createRequire(`${apiDir}/package.json`)('argon2');

const args = process.argv.slice(2);
const [file, out = 'backup.tar'] = args;
// The output must end in `.tar`: under the old `<file> <passphrase>` form the passphrase would
// otherwise be taken for the output name, and the tar written to a file named after it.
if (!file || args.length > 2 || (args.length === 2 && !out.endsWith('.tar'))) {
  console.error('usage: pnpm backup:open <file.lukebak> [out.tar]');
  console.error('The passphrase is prompted for, never passed as an argument.');
  process.exit(1);
}

/** Reads a line from the terminal without echoing it. Ctrl-U clears it, Ctrl-C aborts. */
function promptHidden(prompt) {
  const { stdin, stderr } = process;
  return new Promise(resolve => {
    let value = '';
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write('\n');
    };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          process.exit(130);
        }
        // An escape sequence (an arrow or function key) arrives whole in one chunk, and none of it
        // is part of the passphrase. With nothing echoed, a stray key must not change it silently.
        if (ch === '\u001b') break;
        if (ch === '\u0015') value = '';
        else if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stderr.write(prompt);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/** The first line of piped stdin. */
async function readPipedLine() {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk;
  return text.split(/\r?\n/)[0];
}

/** Prints `message` and exits 1. */
function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Reads exactly `length` bytes at `position`, or refuses a file that ends first. */
async function readExactly(handle, length, position) {
  const buffer = Buffer.alloc(length);
  for (let read = 0; read < length; ) {
    const { bytesRead } = await handle.read(buffer, read, length - read, position + read);
    if (bytesRead === 0) fail('The file ends inside its header: it is truncated, or not a .lukebak package.');
    read += bytesRead;
  }
  return buffer;
}

// A header is a few hundred bytes of JSON: a length beyond this is not a header.
const MAX_HEADER_BYTES = 64 * 1024;

// The file first: a wrong path should not cost the operator a passphrase. Only the header is read;
// the body, possibly many GB, is streamed below.
let input;
try {
  input = await open(file, 'r');
} catch (error) {
  fail(`Cannot read ${file}: ${error.message}`);
}
const { size } = await input.stat();
const headerLength = (await readExactly(input, 4, 0)).readUInt32BE(0);
if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) fail('Not a .lukebak package: its header length is out of bounds.');
let header;
try {
  header = JSON.parse((await readExactly(input, headerLength, 4)).toString('utf8'));
} catch {
  fail('Not a .lukebak package: its header is not readable.');
}
if (header?.version !== 1 || header.algorithm !== 'aes-256-gcm' || header.kdf !== 'argon2id') {
  fail(`Unsupported package (version ${header?.version}): this reader opens version 1, AES-256-GCM with Argon2id.`);
}
// Checked before the passphrase is asked for: a damaged header is not a wrong passphrase.
const isHex = value => typeof value === 'string' && value.length > 0 && /^[0-9a-f]*$/i.test(value) && value.length % 2 === 0;
const wrapped = header.passphraseWrapped ?? {};
if (![wrapped.saltHex, wrapped.ivHex, wrapped.authTagHex, wrapped.ciphertextHex, header.bodyIvHex, header.bodyAuthTagHex].every(isHex)) {
  fail('The header is damaged: a key or IV field is missing or not hex.');
}
const bodyOffset = 4 + headerLength;
const bodyLength = size - bodyOffset;

console.error('--- header ---');
console.error(JSON.stringify(header, null, 2));
console.error(`--- body: ${bodyLength} bytes ---`);
if (String(bodyLength) !== String(header.sizeBytesEncrypted)) {
  fail(`The body is ${bodyLength} bytes and the header says ${header.sizeBytesEncrypted}: the file is truncated or damaged.`);
}

const passphrase = process.stdin.isTTY ? await promptHidden('Passphrase: ') : await readPipedLine();
if (!passphrase) fail('No passphrase given.');

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
// string — see wrapDekWithPassphrase in apps/api/src/lib/backup/crypto.ts. Nothing is written
// before this succeeds.
let bodyDecipher;
try {
  const dekDecipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.passphraseWrapped.ivHex, 'hex'), { authTagLength: 16 });
  dekDecipher.setAuthTag(Buffer.from(header.passphraseWrapped.authTagHex, 'hex'));
  const dek = Buffer.concat([
    dekDecipher.update(Buffer.from(header.passphraseWrapped.ciphertextHex, 'hex')),
    dekDecipher.final(),
  ]);
  bodyDecipher = createDecipheriv('aes-256-gcm', dek, Buffer.from(header.bodyIvHex, 'hex'), { authTagLength: 16 });
  bodyDecipher.setAuthTag(Buffer.from(header.bodyAuthTagHex, 'hex'));
} catch {
  fail('Wrong passphrase: nothing was written.');
}

// Created here, never overwritten: an existing file is the operator's, and is left as it is.
let output;
try {
  output = await open(out, 'wx', 0o600);
} catch (error) {
  fail(error.code === 'EEXIST' ? `${out} already exists and was not touched: choose another name.` : `Cannot create ${out}: ${error.message}`);
}

// Decrypt + gunzip the body into a plain tar. The GCM tag is checked when the body ends: until the
// pipeline completes, the output is unverified, and on any failure — an interruption included — the
// file this run created goes.
const removeOutputAndExit = () => {
  try {
    unlinkSync(out);
  } catch {
    // Already gone.
  }
  process.exit(130);
};
process.once('SIGINT', removeOutputAndExit);
process.once('SIGTERM', removeOutputAndExit);
try {
  await pipeline(input.createReadStream({ start: bodyOffset }), bodyDecipher, createGunzip(), output.createWriteStream());
} catch (error) {
  await unlink(out).catch(() => {});
  // A system call failing (a full disk, an I/O error) is not a damaged package.
  fail(error.syscall
    ? `Writing ${out} failed (${error.message}). ${out} was removed; the package itself was not judged.`
    : `Decryption failed (${error.message}): the package is damaged or altered. ${out} was removed.`);
}
console.error(`OK → ${out}   (tar tvf ${out})`);
