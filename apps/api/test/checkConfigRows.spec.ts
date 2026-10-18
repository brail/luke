import { describe, expect, it } from 'vitest';

import { checkConfigRows, type ConfigRow } from '../scripts/lib/configRows';

/**
 * The upgrade report flags a stored value its registered key no longer accepts. On rc.1 a
 * `storage.type = minio` row carried over from 2.1.6 came out as "OK: nothing needs a decision".
 */

const row = (key: string, value: string, isEncrypted = false): ConfigRow => ({ key, value, isEncrypted });
const BASE_URL = row('app.baseUrl', 'https://luke.example.com');

describe('checkConfigRows', () => {
  it('reports a registered row whose value its schema refuses, by key', () => {
    const report = checkConfigRows([BASE_URL, row('storage.type', 'minio')]);

    expect(report.invalid).toEqual([{ key: 'storage.type', message: expect.any(String) }]);
    expect(report.invalid[0]?.message).not.toBe('');
    expect(report.attention).toBe(true);
  });

  it('leaves a valid row alone', () => {
    const report = checkConfigRows([BASE_URL, row('storage.type', 's3')]);

    expect(report.invalid).toEqual([]);
    expect(report.attention).toBe(false);
  });

  it("lists an empty value apart: 2.1.6 stored '' for \"not configured\", which readers still treat so", () => {
    const report = checkConfigRows([BASE_URL, row('integrations.google.impersonateEmail', '')]);

    expect(report.invalid).toEqual([]);
    expect(report.emptyStored).toEqual(['integrations.google.impersonateEmail']);
    expect(report.attention).toBe(false);
  });

  it('still asks for a decision on a stranded row and a missing app.baseUrl', () => {
    const report = checkConfigRows([row('legacy.unknown', 'x'), row('storage.minio.endpoint', 'minio')]);

    expect(report.strandedOrphans).toEqual(['legacy.unknown']);
    expect(report.deletableOrphans).toEqual(['storage.minio.endpoint']);
    expect(report.hasBaseUrl).toBe(false);
    expect(report.attention).toBe(true);
  });

  it('counts an encrypted row instead of checking it, and never echoes a value', () => {
    const report = checkConfigRows([BASE_URL, row('smtp.port', 'secret-junk', true), row('smtp.secure', 'secret-junk')]);

    expect(report.encryptedSkipped).toBe(1);
    expect(report.invalid.map(i => i.key)).toEqual(['smtp.secure']);
    expect(JSON.stringify(report)).not.toContain('secret-junk');
  });
});
