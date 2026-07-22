/**
 * Tar container helpers for backup archives.
 *
 * Tar is deliberately chosen over a bespoke framing format: even in a true disaster-recovery
 * scenario where none of this codebase is available, a decrypted+decompressed backup can still
 * be inspected/extracted by hand with plain `tar`. The one constraint this imposes is that every
 * tar entry's size must be known before its data is written — `pg_dump`'s output size is not
 * known upfront, so `dumpPipeline.ts` stages it to a local temp file first (see there); every
 * other entry (files replayed from the storage provider) already has a known size and is
 * streamed straight through with no disk staging.
 */

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import * as tarStream from 'tar-stream';

import type { Headers as TarHeaders } from 'tar-stream';

export function createArchivePacker(): tarStream.Pack {
  return tarStream.pack();
}

export function createArchiveExtractor(): tarStream.Extract {
  return tarStream.extract();
}

/** Appends a file already staged on local disk as a tar entry (size read via `fs.stat`). */
export async function addFileEntry(
  pack: tarStream.Pack,
  entryName: string,
  filePath: string
): Promise<void> {
  const stats = await stat(filePath);
  await addStreamEntry(pack, entryName, stats.size, createReadStream(filePath));
}

/** Appends a stream of already-known size as a tar entry, without touching local disk. */
export function addStreamEntry(
  pack: tarStream.Pack,
  entryName: string,
  size: number,
  source: NodeJS.ReadableStream
): Promise<void> {
  return new Promise((resolve, reject) => {
    const entry = pack.entry({ name: entryName, size }, err => {
      if (err) reject(err);
      else resolve();
    });
    source.on('error', reject);
    source.pipe(entry);
  });
}

/**
 * Consumes every entry of a tar extraction stream in order, invoking `handler` for each one.
 * `handler` must fully drain its `stream` argument before resolving (e.g. via `pipeline`).
 */
export function forEachArchiveEntry(
  extract: tarStream.Extract,
  handler: (header: TarHeaders, entryStream: NodeJS.ReadableStream) => Promise<void>
): Promise<void> {
  return new Promise((resolve, reject) => {
    extract.on('entry', (header, entryStream, next) => {
      handler(header, entryStream)
        .then(() => next())
        .catch(err => {
          entryStream.resume();
          next(err);
          reject(err);
        });
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });
}
