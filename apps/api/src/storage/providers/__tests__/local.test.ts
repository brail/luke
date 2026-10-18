import { mkdirSync, mkdtempSync, symlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { StorageObjectNotFoundError } from '@luke/core';

import { LocalFsProvider } from '../local';

describe('LocalFsProvider - Path Traversal Protection', () => {
  let testDir: string;
  let provider: LocalFsProvider;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'luke-storage-test-'));
    provider = new LocalFsProvider({
      basePath: testDir,
      maxFileSizeMB: 10,
    });
    await provider.init();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should block path traversal with ../', () => {
    expect(() => {
      provider['validatePathSafety']('../etc/passwd');
    }).toThrow('Unsafe path');
  });

  it('should block absolute paths', () => {
    expect(() => {
      provider['validatePathSafety']('/etc/passwd');
    }).toThrow('Unsafe path');
  });

  it('should allow valid relative paths', () => {
    const result = provider['validatePathSafety']('uploads/test.txt');
    expect(result).toContain(testDir);
    expect(result).toContain('uploads/test.txt');
  });

  it('should handle symlink on base directory', async () => {
    const symlinkPath = join(tmpdir(), `luke-symlink-test-${Date.now()}`);

    try {
      symlinkSync(testDir, symlinkPath);

      const providerSymlink = new LocalFsProvider({
        basePath: symlinkPath,
        maxFileSizeMB: 10,
      });

      // Should not throw
      await expect(providerSymlink.init()).resolves.not.toThrow();
    } finally {
      try {
        rmSync(symlinkPath, { force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it('should handle trailing slash in paths', () => {
    const result = provider['validatePathSafety']('brand-logos/test/');
    expect(result).toContain(testDir);
    expect(result).toContain('brand-logos/test');
  });

  it('should handle nested directory paths', () => {
    const result = provider['validatePathSafety'](
      'uploads/2025/01/15/test.txt'
    );
    expect(result).toContain(testDir);
    expect(result).toContain('uploads/2025/01/15/test.txt');
  });

  it('should block Windows drive letters', () => {
    expect(() => {
      provider['validatePathSafety']('C:\\Windows\\System32');
    }).toThrow('Unsafe path');
  });

  it('should block null bytes', () => {
    expect(() => {
      provider['validatePathSafety']('uploads/test\x00.txt');
    }).toThrow('Unsafe path');
  });
});

describe('LocalFsProvider.get - absence', () => {
  let testDir: string;
  let provider: LocalFsProvider;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'luke-storage-test-'));
    provider = new LocalFsProvider({ basePath: testDir, maxFileSizeMB: 10 });
    await provider.init();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('throws StorageObjectNotFoundError for a key with no file', async () => {
    await expect(provider.get({ bucket: 'collection-row-pictures', key: '2026/01/01/gone.png' }))
      .rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('throws another error when the bucket itself is missing', async () => {
    rmSync(join(testDir, 'collection-row-pictures'), { recursive: true, force: true });
    const read = provider.get({ bucket: 'collection-row-pictures', key: 'k.png' });
    await expect(read).rejects.toThrow();
    await expect(read).rejects.not.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('throws another error when something other than a file is at the key', async () => {
    mkdirSync(join(testDir, 'collection-row-pictures', 'a-directory'), { recursive: true });
    const read = provider.get({ bucket: 'collection-row-pictures', key: 'a-directory' });
    await expect(read).rejects.toThrow();
    await expect(read).rejects.not.toBeInstanceOf(StorageObjectNotFoundError);
  });
});
