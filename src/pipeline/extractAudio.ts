import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { groq, WHISPER_MODEL } from "../groq.js";
import { downloadSourceVideo } from "../storage.js";
import type { Project, Transcript } from "../types.js";

/**
 * Stage 1: extract_audio
 * Downloads the source video, extracts audio via ffmpeg, transcribes with Groq Whisper.
 * Returns the transcript so the next stage (find_moments) can use it without re-fetching.
 */
export async function extractAndTranscribe(project: Project): Promise<Transcript> {
  if (!project.original_video_url) {
    throw new Error("Project has no original_video_url set");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipforge-"));
  const videoPath = path.join(workDir, "source.mp4");
  const audioPath = path.join(workDir, "audio.mp3");

  try {
    await downloadSourceVideo(project.original_video_url, videoPath);

    // Extract audio only, downsampled — smaller file, faster upload to Groq,
    // and Groq charges/limits by audio duration not resolution.
    execSync(
      `ffmpeg -y -i "${videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${audioPath}"`,
      { stdio: "pipe" }
    );

    // Groq's free tier caps requests at 25MB per file.
    const stats = fs.statSync(audioPath);
    if (stats.size > 25 * 1024 * 1024) {
      throw new Error(
        `Extracted audio is ${(stats.size / 1024 / 1024).toFixed(1)}MB, exceeds Groq's 25MB limit — chunking not yet implemented`
      );
    }

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: WHISPER_MODEL,
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });

    const words = (transcription as any).words?.map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })) ?? [];

    return {
      text: transcription.text,
      words,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
