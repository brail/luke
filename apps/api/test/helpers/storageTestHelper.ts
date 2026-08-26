/**
 * Helper for mock storage provider in tests
 * Simulates in-memory storage behavior for isolated tests
 */

import { Readable } from 'stream';

import type { Context } from '../../src/lib/trpc';

export interface MockFileObject {
  id: string;
  bucket: string;
  key: string;
  contentType: string;
  size: number;
  data: Buffer;
  createdAt: Date;
}

export class MockStorageProvider {
  private files: Map<string, MockFileObject> = new Map();
  private nextId = 1;

  /**
   * `key` is optional because the real `putObject` doesn't receive it: the
   * provider generates it from `originalName`. The mock does the same —
   * requiring it as input produced "Invalid key: must be non-empty string".
   */
  async put(params: {
    bucket: string;
    key?: string;
    originalName?: string;
    /** Optional as in the real `putObject`, which falls back to application/octet-stream. */
    contentType?: string;
    size: number;
    stream: NodeJS.ReadableStream;
  }): Promise<MockFileObject> {
    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of params.stream) {
      chunks.push(chunk as Buffer);
    }
    const data = Buffer.concat(chunks);

    const key =
      params.key ?? `${this.nextId}-${params.originalName ?? 'file.bin'}`;

    const fileObject: MockFileObject = {
      id: `mock-${this.nextId++}`,
      bucket: params.bucket,
      key,
      contentType: params.contentType ?? 'application/octet-stream',
      size: params.size,
      data,
      createdAt: new Date(),
    };

    this.files.set(`${params.bucket}/${key}`, fileObject);
    return fileObject;
  }

  async get(params: {
    bucket: string;
    key: string;
  }): Promise<{ stream: NodeJS.ReadableStream }> {
    const file = this.files.get(`${params.bucket}/${params.key}`);
    if (!file) {
      throw new Error(`File not found: ${params.bucket}/${params.key}`);
    }

    return {
      stream: Readable.from(file.data),
    };
  }

  async delete(params: { bucket: string; key: string }): Promise<void> {
    const key = `${params.bucket}/${params.key}`;
    if (!this.files.has(key)) {
      throw new Error(`File not found: ${key}`);
    }
    this.files.delete(key);
  }

  async list(params: {
    bucket: string;
    prefix?: string;
  }): Promise<MockFileObject[]> {
    const files: MockFileObject[] = [];
    for (const file of this.files.values()) {
      if (file.bucket === params.bucket) {
        if (!params.prefix || file.key.startsWith(params.prefix)) {
          files.push(file);
        }
      }
    }
    return files;
  }

  // Test helper
  getFileCount(): number {
    return this.files.size;
  }

  getFilesByBucket(bucket: string): MockFileObject[] {
    const files: MockFileObject[] = [];
    for (const file of this.files.values()) {
      if (file.bucket === bucket) {
        files.push(file);
      }
    }
    return files;
  }

  clear(): void {
    this.files.clear();
    this.nextId = 1;
  }
}

/**
 * Creates a test context with a mock storage provider
 */
export async function createTestContextWithMockStorage(): Promise<
  Context & { mockStorage: MockStorageProvider }
> {
  const { createContextForRole } = await import('./testContext');
  const context = await createContextForRole();

  const mockStorage = new MockStorageProvider();

  // Mock the storage provider in the context
  const originalPrisma = context.prisma;
  context.prisma = {
    ...originalPrisma,
    fileObject: {
      ...originalPrisma.fileObject,
      create: async (data: any) => {
        // Simulate fileObject creation in the DB
        const fileObject = await originalPrisma.fileObject.create(data);
        return fileObject;
      },
      findFirst: async (params: any) => {
        // For moveTempLogoToBrand tests
        if (params.where?.bucket === 'temp-brand-logos') {
          const files = mockStorage.getFilesByBucket('temp-brand-logos');
          if (files.length > 0) {
            const file = files[0];
            return {
              id: file.id,
              bucket: file.bucket,
              key: file.key,
              contentType: file.contentType,
              size: file.size,
              createdAt: file.createdAt,
            };
          }
        }
        return originalPrisma.fileObject.findFirst(params);
      },
      delete: async (params: any) => {
        return originalPrisma.fileObject.delete(params);
      },
    },
  } as any;

  return {
    ...context,
    mockStorage,
  };
}

/**
 * Helper to create test files
 */
export function createTestFile(
  filename: string,
  contentType: string,
  size: number,
  content?: Buffer
): {
  filename: string;
  mimetype: string;
  stream: NodeJS.ReadableStream;
  size: number;
} {
  const buffer = content || Buffer.from('test file content');
  return {
    filename,
    mimetype: contentType,
    stream: Readable.from(buffer),
    size,
  };
}

/**
 * Helper to create valid PNG images for tests
 */
export function createValidPngBuffer(): Buffer {
  // PNG header + minimal PNG data
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const pngData = Buffer.from('test png content');
  return Buffer.concat([pngHeader, pngData]);
}

/**
 * Helper to create valid JPEG images for tests
 */
export function createValidJpegBuffer(): Buffer {
  // JPEG header
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const jpegData = Buffer.from('test jpeg content');
  return Buffer.concat([jpegHeader, jpegData]);
}

/**
 * Helper to create a file with wrong magic bytes (for validation tests)
 */
export function createInvalidImageBuffer(): Buffer {
  // Txt file with a .png extension
  return Buffer.from('This is not an image file');
}

/**
 * Helper to create valid WebP images for tests (RIFF container header)
 */
export function createValidWebpBuffer(): Buffer {
  const riffHeader = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  const webpData = Buffer.from('test webp content');
  return Buffer.concat([riffHeader, webpData]);
}
