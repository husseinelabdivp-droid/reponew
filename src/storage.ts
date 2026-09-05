import fs from "node:fs";
import { r2, R2_BUCKET, R2_PUBLIC_URL, GetObjectCommand, PutObjectCommand } from "./r2.js";

/**
 * projects.original_video_url is a full R2 public URL, e.g.
 * https://pub-xxxx.r2.dev/videos/{userId}/{projectId}/original.mp4
 * This normalizes it down to the bucket-relative object key.
 */
function toObjectKey(originalVideoUrl: string): string {
  if (!originalVideoUrl.startsWith("http")) {
    return originalVideoUrl;
  }
  const prefix = `${R2_PUBLIC_URL}/`;
  if (!originalVideoUrl.startsWith(prefix)) {
    throw new Error(
      `Unexpected video URL host, expected it to start with ${prefix}: ${originalVideoUrl}`
    );
  }
  return originalVideoUrl.slice(prefix.length);
}

export async function downloadSourceVideo(
  originalVideoUrl: string,
  destPath: string
): Promise<void> {
  const key = toObjectKey(originalVideoUrl);
  const result = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const body = result.Body;
  if (!body) {
    throw new Error(`Failed to download source video (${key}): empty response body`);
  }
  const chunks: Buffer[] = [];
  // @ts-ignore - Body is a Node Readable stream in the Node runtime
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  fs.writeFileSync(destPath, Buffer.concat(chunks));
}

export async function uploadClip(
  userId: string,
  projectId: string,
  localFilePath: string,
  fileName: string
): Promise<string> {
  const key = `clips/${userId}/${projectId}/${fileName}`;
  const fileBuffer = fs.readFileSync(localFilePath);
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: "video/mp4",
    })
  );
  return key;
}
