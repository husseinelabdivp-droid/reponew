import { groq, LLM_MODEL } from "../groq.js";
import type { MomentCandidate, Project, Transcript } from "../types.js";

/**
 * Stage 2: find_moments
 * Sends the transcript to a free Groq LLM and asks it to identify the best
 * short-form clip-worthy moments, scored across the dimensions your `clips`
 * table already tracks (hook_score, entertainment_score, etc).
 */
export async function findMoments(
  project: Project,
  transcript: Transcript
): Promise<MomentCandidate[]> {
  const clipCount = project.requested_clip_count ?? 3;

  const prompt = `You are an expert short-form video editor. Below is a timestamped transcript of a ${project.content_type ?? "video"}.

Identify the ${clipCount} BEST moments to turn into standalone short clips (like TikTok/YouTube Shorts). Each clip should be self-contained, 15-90 seconds, and have a strong hook in the first 3 seconds.

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
    temperature: 0.4,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Groq returned an empty response for find_moments");
  }

  const parsed = JSON.parse(raw);
  // Some models wrap the array in a key when json_object mode is forced — handle both shapes.
  const candidates: any[] = Array.isArray(parsed) ? parsed : parsed.clips ?? parsed.moments ?? [];

  return candidates.map((c) => ({
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
}
