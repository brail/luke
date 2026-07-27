/**
 * Binary envelope for a passphrase-portable backup export/import package (`.lukebak`).
 *
 * Format: `[4-byte big-endian header length][header JSON][original encrypted backup blob, unchanged]`.
 * The body is the exact same ciphertext already sitting in the "backups" bucket — export/import
 * never decrypt/re-encrypt the (potentially multi-GB) archive itself, only the small DEK's
 * wrapping changes (server master key ⇄ passphrase-derived key). This keeps both directions
 * streaming and cheap regardless of backup size.
 */

import { Readable } from 'stream';

import { BackupExportHeaderSchema, type BackupExportHeader } from '@luke/core';

const HEADER_LENGTH_BYTES = 4;

/** Builds the length-prefixed header buffer to prepend to the original ciphertext blob. */
export function encodeExportHeader(header: BackupExportHeader): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(HEADER_LENGTH_BYTES);
  length.writeUInt32BE(json.length, 0);
  return Buffer.concat([length, json]);
}

/**
 * Reads just enough of an incoming `.lukebak` stream to parse its header, then returns the
 * remaining bytes as a fresh `Readable` — without buffering the (potentially multi-GB) body
 * in memory.
 */
export async function splitExportEnvelope(
  input: NodeJS.ReadableStream
): Promise<{ header: BackupExportHeader; body: Readable }> {
  const iterator = (input as Readable)[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let bufferedLength = 0;

  // Accumulates chunks in an array and concatenates only once per call (not once per chunk),
  // so peeking the header stays O(bytes read) instead of O(chunks²).
  async function readAtLeast(n: number): Promise<Buffer> {
    while (bufferedLength < n) {
      const { value, done } = await iterator.next();
      if (done) throw new Error('Pacchetto di export troncato');
      const chunk = value as Buffer;
      chunks.push(chunk);
      bufferedLength += chunk.length;
    }
    return Buffer.concat(chunks, bufferedLength);
  }

  const headerLength = (await readAtLeast(HEADER_LENGTH_BYTES)).readUInt32BE(0);
  const buffered = await readAtLeast(HEADER_LENGTH_BYTES + headerLength);

  const headerJson = buffered
    .subarray(HEADER_LENGTH_BYTES, HEADER_LENGTH_BYTES + headerLength)
    .toString('utf8');
  const header = BackupExportHeaderSchema.parse(JSON.parse(headerJson));
  const leftover = buffered.subarray(HEADER_LENGTH_BYTES + headerLength);

  async function* bodyGenerator() {
    if (leftover.length > 0) yield leftover;
    while (true) {
      const { value, done } = await iterator.next();
      if (done) return;
      yield value;
    }
  }

  return { header, body: Readable.from(bodyGenerator()) };
}
