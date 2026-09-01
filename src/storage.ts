import { supabase } from "./supabase.js";
import fs from "node:fs";

const VIDEOS_BUCKET = "videos";
const CLIPS_BUCKET = "clips"; // adjust if your output bucket has a different name

/**
 * projects.original_video_url may be stored as either:
 *  - a bare storage path, e.g. "userId/filename.mp4"
 *  - a full URL (public or signed), e.g. ".../object/public/videos/userId/filename.mp4?..."
 * This normalizes either form down to the bucket-relative path.
 */
function toStoragePath(originalVideoUrl: string): string {
  if (!originalVideoUrl.startsWith("http")) {
    return originalVideoUrl;
  }
  const marker = `/${VIDEOS_BUCKET}/`;
  const idx = originalVideoUrl.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      `Could not extract storage path from original_video_url: ${originalVideoUrl}`
    );
  }
  const afterBucket = originalVideoUrl.slice(idx + marker.length);
  return afterBucket.split("?")[0]; // strip any signed-url query params
}

export async function downloadSourceVideo(
  originalVideoUrl: string,
  destPath: string
): Promise<void> {
  const path = toStoragePath(originalVideoUrl);
  const { data, error } = await supabase.storage
    .from(VIDEOS_BUCKET)
    .download(path);

  if (error || !data) {
    throw new Error(`Failed to download source video (${path}): ${error?.message}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

export async function uploadClip(
  userId: string,
  projectId: string,
  localFilePath: string,
  fileName: string
): Promise<string> {
  const storagePath = `${userId}/${projectId}/${fileName}`;
  const fileBuffer = fs.readFileSync(localFilePath);

  const { error } = await supabase.storage
    .from(CLIPS_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: "video/mp4",
      upsert: true,
    });

  if (error) {
    throw new Error(`Failed to upload clip (${storagePath}): ${error.message}`);
  }

  return storagePath;
}
