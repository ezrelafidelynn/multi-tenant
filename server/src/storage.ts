import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

export const s3 = new S3Client({
  region: config.s3.region,
  endpoint: config.s3.endpoint,
  forcePathStyle: config.s3.forcePathStyle, // required for MinIO
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

/** Object key layout keeps tenants physically separated in the bucket too. */
export function buildStorageKey(orgId: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-120);
  return `org/${orgId}/${new Date().getFullYear()}/${randomUUID()}-${safe}`;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export function presignGet(key: string, expiresIn = 300) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
    { expiresIn },
  );
}

export async function deleteObject(key: string) {
  await s3.send(
    new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key }),
  );
}
