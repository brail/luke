import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { generateStorageKey } from '../keys';

/**
 * Storage keys are partitioned by day. The providers and the presigned upload used to read that day
 * with the local getters of `Date`, right only because the production image sets `TZ=UTC`; the key
 * now names the UTC day whatever the zone of the process.
 */
describe('generateStorageKey', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('partitions by the UTC day, whatever the zone of the process', () => {
    // 23:30Z on 30 June is already 1 July in Kiritimati (UTC+14).
    process.env.TZ = 'Pacific/Kiritimati';
    // The switch took effect: the process reads the wall clock at UTC+14.
    expect(new Date('2026-06-30T23:30:00Z').getTimezoneOffset()).toBe(-840);
    expect(generateStorageKey('image/png', new Date('2026-06-30T23:30:00Z'))).toMatch(/^2026\/06\/30\/[0-9a-f-]{36}\.png$/);
  });

  it.each([
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/webp', '.webp'],
    ['application/pdf', ''],
    [undefined, ''],
  ])('names the extension of %s', (contentType, extension) => {
    expect(generateStorageKey(contentType, new Date('2026-06-30T12:00:00Z'))).toMatch(new RegExp(`^2026/06/30/[0-9a-f-]{36}${extension.replace('.', '\\.')}$`));
  });
});
