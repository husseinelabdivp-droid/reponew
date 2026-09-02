import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { supabase } from "../supabase.js";
import { downloadSourceVideo, uploadClip } from "../storage.js";
import type { MomentCandidate, Project } from "../types.js";

/**
 * Stage 3: generate_clips
 * Cuts the source video at each moment's timestamps and uploads the result.
 * Inserts one row per clip into the `clips` table.
 */
export async function generateClips(
  project: Project,
  moments: MomentCandidate[]
): Promise<void> {
  if (!project.original_video_url) {
    throw new Error("Project has no original_video_url set");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipforge-clips-"));
  const sourcePath = path.join(workDir, "source.mp4");

  try {
    await downloadSourceVideo(project.original_video_url, sourcePath);

    for (let i = 0; i < moments.length; i++) {
      const moment = moments[i];
      const outFileName = `clip-${i + 1}.mp4`;
      const outPath = path.join(workDir, outFileName);
      const duration = moment.end_time - moment.start_time;

      // -ss before -i is fast-seek; re-encoding (not -c copy) so cuts land on exact timestamps.
      // preset ultrafast + single thread keeps memory use low enough to survive
      // Railway's default container memory limits.
      execSync(
        `ffmpeg -y -ss ${moment.start_time} -i "${sourcePath}" -t ${duration} ` +
          `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" ` +
          `-c:v libx264 -preset ultrafast -threads 1 -c:a aac "${outPath}"`,
        { stdio: "pipe" }
      );

      const storagePath = await uploadClip(project.user_id, project.id, outPath, outFileName);

      const { data: publicUrlData } = supabase.storage
        .from("clips")
        .getPublicUrl(storagePath);

      const { error: insertError } = await supabase.from("clips").insert({
        project_id: project.id,
        start_time: moment.start_time,
        end_time: moment.end_time,
        score: moment.score,
        hook_score: moment.hook_score,
        entertainment_score: moment.entertainment_score,
        emotion_score: moment.emotion_score,
        context_score: moment.context_score,
        shareability_score: moment.shareability_score,
        hook: moment.hook,
        title: moment.title,
        description: moment.description,
        hashtags: moment.hashtags,
        status: "completed",
        output_url: publicUrlData.publicUrl,
      });

      if (insertError) {
        throw new Error(`Failed to insert clip row: ${insertError.message}`);
      }
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
