import { groq, LLM_MODEL } from "../groq.js";
import type { MomentCandidate, Project, Transcript } from "../types.js";

const MIN_DURATION = 15;
const MAX_DURATION = 90;

/**
 * Stage 2: find_moments
 * Sends the transcript to a free Groq LLM and asks it to identify the best
 * short-form clip-worthy moments, scored across the dimensions your `clips`
 * table already tracks (hook_score, entertainment_score, etc).
 *
 * IMPORTANT: LLMs are unreliable about numeric constraints (duration, no
 * overlap), so this function does NOT trust the model's start/end times
 * blindly. It clamps durations into [MIN_DURATION, MAX_DURATION] using the
 * real transcript word timestamps, then greedily drops any candidate that
 * overlaps a higher-scored one already picked.
 */
export async function findMoments(
  project: Project,
  transcript: Transcript
): Promise<MomentCandidate[]> {
  const clipCount = project.requested_clip_count ?? 3;

  const transcriptEnd =
    transcript.words.length > 0
      ? transcript.words[transcript.words.length - 1].end
      : 0;

  const prompt = `You are an expert short-form video editor. Below is a timestamped transcript of a ${project.content_type ?? "video"}.

Identify the ${clipCount} BEST moments to turn into standalone short clips (like TikTok/YouTube Shorts).

HARD RULES — follow these exactly:
- Every clip's duration (end_time - start_time) MUST be between ${MIN_DURATION} and ${MAX_DURATION} seconds. Clips shorter than ${MIN_DURATION} seconds are USELESS and will be discarded — do not submit them.
- Clips MUST NOT overlap each other. Pick moments from clearly different parts of the video.
- Use ONLY timestamps that appear in the transcript below (start_time and end_time must fall between 0 and ${transcriptEnd.toFixed(1)} seconds). Do not invent timestamps.
- Each clip must be self-contained and have a strong hook in its first 3 seconds.

Transcript (with word-level timestamps in seconds):
${JSON.stringify(transcript.words)}

Respond with ONLY a JSON array (no markdown, no prose) of exactly ${clipCount} objects, each shaped like:
{
  "start_time": number,
  "end_time": number,
  "title": string,
  "hook": string (the opening line/moment that grabs attention),
  "description": string,
  "hashtags": string[] (3-5 relevant hashtags, no # symbol),
  "hook_score": number (0-100, how strong the opening hook is),
  "entertainment_score": number (0-100),
  "emotion_score": number (0-100),
  "context_score": number (0-100, how well it stands alone without full context),
  "shareability_score": number (0-100)
}`;

  const completion = await groq.chat.completions.create({
    model: LLM_MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Groq returned an empty response for find_moments");
  }

  const parsed = JSON.parse(raw);
  // Some models wrap the array in a key when json_object mode is forced — handle both shapes.
  const rawCandidates: any[] = Array.isArray(parsed) ? parsed : parsed.clips ?? parsed.moments ?? [];

  const scored: MomentCandidate[] = rawCandidates.map((c) => ({
    start_time: c.start_time,
    end_time: c.end_time,
    title: c.title,
    hook: c.hook,
    description: c.description,
    hashtags: c.hashtags ?? [],
    hook_score: c.hook_score ?? 0,
    entertainment_score: c.entertainment_score ?? 0,
    emotion_score: c.emotion_score ?? 0,
    context_score: c.context_score ?? 0,
    shareability_score: c.shareability_score ?? 0,
    score:
      (c.hook_score + c.entertainment_score + c.emotion_score + c.context_score + c.shareability_score) /
      5,
  }));

  // --- Code-level enforcement (don't trust the model's numbers blindly) ---

  const fixed = scored
    .map((m) => {
      let start = Math.max(0, m.start_time);
      let end = Math.min(transcriptEnd, m.end_time);

      if (end <= start) return null;

      let duration = end - start;

      // Too short: try to extend forward (up to transcriptEnd) to hit the minimum.
      if (duration < MIN_DURATION) {
        end = Math.min(transcriptEnd, start + MIN_DURATION);
        duration = end - start;
      }

      // Too long: trim.
      if (duration > MAX_DURATION) {
        end = start + MAX_DURATION;
        duration = MAX_DURATION;
      }

      // Still too short (e.g. moment was near the very end of the video) — unusable.
      if (duration < MIN_DURATION) return null;

      return { ...m, start_time: start, end_time: end };
    })
    .filter((m): m is MomentCandidate => m !== null)
    // Best moments first, so overlap-resolution keeps the highest-scored ones.
    .sort((a, b) => b.score - a.score);

  const selected: MomentCandidate[] = [];
  for (const candidate of fixed) {
    const overlaps = selected.some(
      (s) => candidate.start_time < s.end_time && candidate.end_time > s.start_time
    );
    if (!overlaps) {
      selected.push(candidate);
    }
    if (selected.length >= clipCount) break;
  }

  if (selected.length < clipCount) {
    console.warn(
      `find_moments: only ${selected.length}/${clipCount} candidates survived duration/overlap validation for project ${project.id}`
    );
  }

  // Restore chronological order for the final cut list.
  return selected.sort((a, b) => a.start_time - b.start_time);
}
