import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const s3Endpoint = process.env.S3_ENDPOINT;
const s3ApiKey = process.env.S3_API_KEY;

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    if (!s3Endpoint || !s3ApiKey) {
      throw new Error(
        "S3 is not configured. Set S3_ENDPOINT and S3_API_KEY environment variables."
      );
    }
    _client = new S3Client({
      endpoint: s3Endpoint,
      region: "us-east-1",
      credentials: {
        accessKeyId: s3ApiKey,
        secretAccessKey: "unused",
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

export function isS3Configured(): boolean {
  return !!(s3Endpoint && s3ApiKey);
}

export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: "any",
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

export async function downloadFromS3(
  key: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: "any", Key: key })
  );
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) throw new Error("Empty body from S3");
  return {
    buffer: Buffer.from(bytes),
    contentType: result.ContentType || "application/octet-stream",
  };
}

export async function deleteFromS3(key: string): Promise<void> {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: "any", Key: key })
    );
  } catch (err) {
    console.error(`S3 delete error for key ${key}:`, err);
  }
}

export function buildDocumentKey(
  studentId: number,
  documentId: number,
  filename: string
): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `documents/${studentId}/${documentId}/${safe}`;
}

export function buildProfileImageKey(userId: string): string {
  return `profiles/${userId}/photo`;
}

export function isS3Key(value: string | null | undefined): boolean {
  if (!value) return false;
  return (
    !value.startsWith("data:") &&
    !value.startsWith("http://") &&
    !value.startsWith("https://") &&
    value.includes("/")
  );
}
