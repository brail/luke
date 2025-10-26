/**
 * Helper per mock storage provider nei test
 * Simula comportamento storage in-memory per test isolati
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

  async put(params: {
    bucket: string;
    key: string;
    contentType: string;
    size: number;
    stream: NodeJS.ReadableStream;
  }): Promise<MockFileObject> {
    // Converti stream in buffer
    const chunks: Buffer[] = [];
    for await (const chunk of params.stream) {
      chunks.push(chunk as Buffer);
    }
    const data = Buffer.concat(chunks);

    const fileObject: MockFileObject = {
      id: `mock-${this.nextId++}`,
      bucket: params.bucket,
      key: params.key,
      contentType: params.contentType,
      size: params.size,
      data,
      createdAt: new Date(),
    };

    this.files.set(`${params.bucket}/${params.key}`, fileObject);
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

  // Helper per test
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
 * Crea context di test con mock storage provider
 */
export async function createTestContextWithMockStorage(): Promise<
  Context & { mockStorage: MockStorageProvider }
> {
  const { createTestContext } = await import('./testContext');
  const context = await createTestContext();

  const mockStorage = new MockStorageProvider();

  // Mock del storage provider nel context
  const originalPrisma = context.prisma;
  context.prisma = {
    ...originalPrisma,
    fileObject: {
      ...originalPrisma.fileObject,
      create: async (data: any) => {
        // Simula creazione fileObject nel DB
        const fileObject = await originalPrisma.fileObject.create(data);
        return fileObject;
      },
      findFirst: async (params: any) => {
        // Per i test di moveTempLogoToBrand
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
 * Helper per creare file di test
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
 * Helper per creare immagini PNG valide per test
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
 * Helper per creare immagini JPEG valide per test
 */
export function createValidJpegBuffer(): Buffer {
  // JPEG header
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const jpegData = Buffer.from('test jpeg content');
  return Buffer.concat([jpegHeader, jpegData]);
}

/**
 * Helper per creare file con magic bytes sbagliati (per test validazione)
 */
export function createInvalidImageBuffer(): Buffer {
  // File txt con estensione .png
  return Buffer.from('This is not an image file');
}
