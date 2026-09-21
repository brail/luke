import { describe, it, expect, vi } from 'vitest';

import { APP_STORAGE_BUCKETS } from '@luke/core';
import type { S3StorageConfig, StorageBucket } from '@luke/core';

import { S3Provider } from '../s3';

/**
 * `S3Provider.init()` is the only path that creates buckets on an S3-compatible backend:
 * the `mc`-based sidecar that used to do it was removed (ADR-012). A bucket missing from
 * its list is therefore never created, and the first upload to it fails at runtime.
 *
 * These tests pin the list against `APP_STORAGE_BUCKETS` so that adding a bucket there
 * cannot silently skip creation, and they assert the private `backups` bucket is still
 * ensured even though the shared constant deliberately excludes it.
 *
 * No request leaves the process: the provider's S3 client is replaced with a recorder.
 */

const CONFIG: S3StorageConfig = {
  endpoint: 'storage.invalid',
  port: 8333,
  useSSL: false,
  accessKey: 'test-access-key',
  secretKey: 'test-secret-key',
  region: 'us-east-1',
  presignedPutTtl: 3600,
  presignedGetTtl: 3600,
};

/** Every bucket `init()` must ensure: the application buckets plus the private `backups` bucket. */
const EXPECTED_BUCKETS: readonly StorageBucket[] = [...APP_STORAGE_BUCKETS, 'backups'];

interface RecordedCommand {
  name: string;
  bucket: string | undefined;
}

interface StubbedCommand {
  constructor: { name: string };
  input: { Bucket?: string };
}

/**
 * Replaces the provider's S3 client with a recorder, so the suite needs no network and no
 * running backend. `client` is private and readonly, which is a compile-time constraint only;
 * the double assertion replaces it wholesale rather than widening the class's visibility for
 * the benefit of a test.
 *
 * @param provider - Provider whose client is replaced.
 * @param missing - Buckets whose `HeadBucketCommand` should reject, simulating absence.
 */
function stubClient(provider: S3Provider, missing: ReadonlySet<string> = new Set()) {
  const sent: RecordedCommand[] = [];

  const send = vi.fn(async (command: StubbedCommand) => {
    const name = command.constructor.name;
    sent.push({ name, bucket: command.input.Bucket });
    if (name === 'HeadBucketCommand' && missing.has(String(command.input.Bucket))) {
      throw new Error('NotFound');
    }
    return {};
  });

  (provider as unknown as { client: { send: typeof send } }).client = { send };
  return { sent, send };
}

const bucketsFor = (sent: readonly RecordedCommand[], command: string): string[] =>
  sent.filter(c => c.name === command).map(c => String(c.bucket)).sort();

describe('S3Provider.init — bucket provisioning', () => {
  it('checks exactly the expected buckets, and creates none when they all exist', async () => {
    const provider = new S3Provider(CONFIG);
    const { sent, send } = stubClient(provider);

    await provider.init();

    expect(bucketsFor(sent, 'HeadBucketCommand')).toEqual([...EXPECTED_BUCKETS].sort());
    expect(bucketsFor(sent, 'CreateBucketCommand')).toEqual([]);
    expect(send).toHaveBeenCalledTimes(EXPECTED_BUCKETS.length);
  });

  it('creates exactly the buckets whose HeadBucket check fails', async () => {
    const provider = new S3Provider(CONFIG);
    const missing = new Set(['exports', 'backups']);
    const { sent } = stubClient(provider, missing);

    await provider.init();

    expect(bucketsFor(sent, 'HeadBucketCommand')).toEqual([...EXPECTED_BUCKETS].sort());
    expect(bucketsFor(sent, 'CreateBucketCommand')).toEqual(['backups', 'exports']);
  });

  it('ensures the private backups bucket that APP_STORAGE_BUCKETS deliberately excludes', async () => {
    const provider = new S3Provider(CONFIG);
    const { sent } = stubClient(provider);

    await provider.init();

    expect(APP_STORAGE_BUCKETS as readonly string[]).not.toContain('backups');
    expect(bucketsFor(sent, 'HeadBucketCommand')).toContain('backups');
  });

  it('covers every bucket the shared constant declares, so a new one cannot be skipped', async () => {
    const provider = new S3Provider(CONFIG);
    const { sent } = stubClient(provider);

    await provider.init();

    const checked = new Set(bucketsFor(sent, 'HeadBucketCommand'));
    for (const bucket of APP_STORAGE_BUCKETS) {
      expect(checked.has(bucket)).toBe(true);
    }
  });

  it('issues no command other than HeadBucket and CreateBucket', async () => {
    const provider = new S3Provider(CONFIG);
    const { sent } = stubClient(provider, new Set(['assets']));

    await provider.init();

    const commands = new Set(sent.map(c => c.name));
    expect([...commands].sort()).toEqual(['CreateBucketCommand', 'HeadBucketCommand']);
  });
});
