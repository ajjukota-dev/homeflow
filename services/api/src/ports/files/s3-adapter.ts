import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FilesPort } from "./types";
import { assertSafeKey } from "./types";

const PRESIGN_TTL_SECONDS = 900;

// Prod adapter: real presigned S3 URLs, bucket from env (FILES_BUCKET).
export function createS3FilesAdapter(bucket: string, region: string): FilesPort {
  const client = new S3Client({ region });
  return {
    async putPresigned(key, contentType) {
      assertSafeKey(key);
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: PRESIGN_TTL_SECONDS }
      );
      return { url, method: "PUT", headers: { "content-type": contentType } };
    },
    async getPresigned(key) {
      assertSafeKey(key);
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: PRESIGN_TTL_SECONDS,
      });
    },
    async delete(key) {
      assertSafeKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
