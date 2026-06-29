/**
 * MinIO (S3-compatible) implementation of IStorageProvider.
 *
 * Uses two S3Client instances: one for internal server-to-MinIO traffic and one
 * for presigned URL generation that points to the browser-reachable public endpoint
 * (configured via `storage.minio.publicBaseUrl` in AppConfig).
 * Bucket auto-creation is performed at initialization for all known buckets.
 */

import { randomUUID } from 'crypto';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  IStorageCapabilities,
  IStorageProvider,
  MinioStorageConfig,
  PresignedGetParams,
  PresignedGetResult,
  PresignedPutParams,
  PresignedPutResult,
  StorageBucket,
  StorageDeleteParams,
  StorageGetParams,
  StorageGetResult,
  StorageListParams,
  StorageListResult,
  StoragePutParams,
  StoragePutResult,
} from '@luke/core';

/** MinIO / S3-compatible storage provider. Implements IStorageProvider using the AWS SDK v3. */
export class MinioProvider implements IStorageProvider {
  readonly capabilities: IStorageCapabilities = {
    supportsPresignedUpload: true,
    supportsPresignedDownload: true,
  };

  private readonly client: S3Client;
  /** Used for presigned URL generation — points to the browser-reachable host */
  private readonly presignClient: S3Client;
  private readonly config: MinioStorageConfig;

  constructor(config: MinioStorageConfig) {
    this.config = config;
    const protocol = config.useSSL ? 'https' : 'http';
    const internalEndpoint = `${protocol}://${config.endpoint}:${config.port}`;
    const credentials = {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    };

    this.client = new S3Client({
      endpoint: internalEndpoint,
      region: config.region,
      credentials,
      forcePathStyle: true,
    });

    // Presigned URLs must use the public-facing endpoint so browsers can reach them.
    // If publicBaseUrl is not set, fall back to the internal endpoint (works when
    // MinIO is directly accessible on the same hostname, e.g. local dev without Docker).
    const presignEndpoint = config.publicBaseUrl || internalEndpoint;
    this.presignClient = presignEndpoint === internalEndpoint
      ? this.client
      : new S3Client({
          endpoint: presignEndpoint,
          region: config.region,
          credentials,
          forcePathStyle: true,
        });
  }

  /**
   * Ensures all known buckets exist in MinIO, creating any that are missing.
   */
  async init(): Promise<void> {
    const allBuckets: StorageBucket[] = [
      'uploads',
      'exports',
      'assets',
      'brand-logos',
      'collection-row-pictures',
      'collection-row-pictures-revisions',
      'merchandising-specsheet-images',
      'company-assets',
    ];

    await Promise.all(allBuckets.map(async bucket => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    }));
  }

  /** Generate a key with the same date-partitioned format as LocalFsProvider */
  private generateKey(contentType?: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const uuid = randomUUID();
    const ext = this.extFromMime(contentType);
    return `${year}/${month}/${day}/${uuid}${ext}`;
  }

  private extFromMime(mime?: string): string {
    switch (mime) {
      case 'image/png':  return '.png';
      case 'image/jpeg':
      case 'image/jpg':  return '.jpg';
      case 'image/webp': return '.webp';
      default:           return '';
    }
  }

  /**
   * Uploads a file to MinIO and returns its generated key, SHA-256 checksum, and byte size.
   */
  async put(params: StoragePutParams): Promise<StoragePutResult> {
    const key = this.generateKey(params.contentType);
    const chunks: Buffer[] = [];
    for await (const chunk of params.stream) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);

    await this.client.send(new PutObjectCommand({
      Bucket: params.bucket,
      Key: key,
      Body: body,
      ContentType: params.contentType,
    }));

    const { createHash } = await import('crypto');
    const checksumSha256 = createHash('sha256').update(body).digest('hex');

    return { key, checksumSha256, size: body.length };
  }

  /**
   * Retrieves a file from MinIO as a readable stream.
   *
   * @throws If the object does not exist in the bucket.
   */
  async get(params: StorageGetParams): Promise<StorageGetResult> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    }));

    if (!res.Body) throw new Error(`Object not found: ${params.bucket}/${params.key}`);

    return {
      stream: res.Body as unknown as NodeJS.ReadableStream,
      size: res.ContentLength ?? 0,
      contentType: res.ContentType ?? 'application/octet-stream',
    };
  }

  /** Deletes a file from MinIO. */
  async delete(params: StorageDeleteParams): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    }));
  }

  /**
   * Lists objects in a MinIO bucket, with optional prefix and limit.
   *
   * @returns Page items and an optional continuation token for the next page.
   */
  async list(params: StorageListParams): Promise<StorageListResult> {
    const res = await this.client.send(new ListObjectsV2Command({
      Bucket: params.bucket,
      Prefix: params.prefix,
      MaxKeys: params.limit ?? 100,
      ContinuationToken: params.cursor,
    }));

    const items = (res.Contents ?? []).map(obj => ({
      key: obj.Key!,
      size: obj.Size ?? 0,
      modifiedAt: obj.LastModified ?? new Date(),
    }));

    return {
      items,
      nextCursor: res.NextContinuationToken,
    };
  }

  /**
   * Generates a presigned PUT URL for direct browser-to-MinIO upload.
   *
   * Uses the public presign client so the URL points to the browser-reachable endpoint.
   *
   * @returns The presigned URL, the key under which the file will be stored, and its expiry time.
   */
  async getPresignedPutUrl(params: PresignedPutParams): Promise<PresignedPutResult> {
    const key = params.key ?? this.generateKey(params.contentType);
    const ttl = params.expiresIn ?? this.config.presignedPutTtl;

    const url = await getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: key,
        ContentType: params.contentType,
      }),
      { expiresIn: ttl },
    );

    return {
      url,
      key,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  /**
   * Generates a presigned GET URL for time-limited direct download from MinIO.
   *
   * @returns The presigned URL and its expiry time.
   */
  async getPresignedGetUrl(params: PresignedGetParams): Promise<PresignedGetResult> {
    const ttl = params.expiresIn ?? this.config.presignedGetTtl;

    const url = await getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
      }),
      { expiresIn: ttl },
    );

    return {
      url,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  /** Public URL for a key in a public-read bucket (no presigning needed) */
  getPublicUrl(bucket: StorageBucket, key: string): string {
    const base = this.config.publicBaseUrl;
    if (base) return `${base}/${bucket}/${key}`;
    const protocol = this.config.useSSL ? 'https' : 'http';
    return `${protocol}://${this.config.endpoint}:${this.config.port}/${bucket}/${key}`;
  }
}
