import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// TODO: calibrate to your actual HUD — this is a starting guess for a
// 1440x1080 CS2 recording with the killfeed in its default top-right spot.
const KILLFEED_CROP = { w: 500, h: 200, x: 940, y: 20 };
const SAMPLE_FPS = 4;
const DEDUPE_WINDOW_SECONDS = 6; // ignore the same killfeed line reappearing within this window

export interface KillEvent {
  time: number;
}

export async function detectKillEvents(videoPath: string): Promise<KillEvent[]> {
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipforge-frames-"));
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -vf "fps=${SAMPLE_FPS},crop=${KILLFEED_CROP.w}:${KILLFEED_CROP.h}:${KILLFEED_CROP.x}:${KILLFEED_CROP.y}" -q:v 2 "${path.join(frameDir, "frame_%05d.jpg")}"`,
      { stdio: "pipe" }
    );

    const frameFiles = fs.readdirSync(frameDir).filter((f) => f.endsWith(".jpg")).sort();
    const events: KillEvent[] = [];
    const lastSeenAtFrame = new Map<string, number>();

    for (let i = 0; i < frameFiles.length; i++) {
      const framePath = path.join(frameDir, frameFiles[i]);
      const time = i / SAMPLE_FPS;

      let text = "";
      try {
        text = execSync(`tesseract "${framePath}" stdout --psm 6`, { stdio: "pipe" }).toString();
      } catch {
        continue; // blank/unreadable frame, skip
      }

      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length >= 3);

      for (const line of lines) {
        const lastFrame = lastSeenAtFrame.get(line);
        const isNew = lastFrame === undefined || i - lastFrame > SAMPLE_FPS * DEDUPE_WINDOW_SECONDS;
        if (isNew) {
          events.push({ time });
        }
        lastSeenAtFrame.set(line, i);
      }
    }

    return events;
  } finally {
    fs.rmSync(frameDir, { recursive: true, force: true });
  }
}

export interface KillMoment {
  start_time: number;
  end_time: number;
  killCount: number;
}

const MULTI_KILL_WINDOW = 10; // seconds between kills to count as the same "run"
const PRE_ROLL = 4;
const POST_ROLL = 4;

export function groupKillEvents(events: KillEvent[]): KillMoment[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.time - b.time);

  const groups: KillMoment[] = [];
  let current: KillMoment = { start_time: sorted[0].time, end_time: sorted[0].time, killCount: 1 };

  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i].time;
    if (t - current.end_time <= MULTI_KILL_WINDOW) {
      current.end_time = t;
      current.killCount++;
    } else {
      groups.push(current);
      current = { start_time: t, end_time: t, killCount: 1 };
    }
  }
  groups.push(current);

  return groups
    .map((g) => ({
      start_time: Math.max(0, g.start_time - PRE_ROLL),
      end_time: g.end_time + POST_ROLL,
      killCount: g.killCount,
    }))
    .sort((a, b) => b.killCount - a.killCount);
}
