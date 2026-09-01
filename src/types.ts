export interface ProcessingJob {
  id: string;
  project_id: string;
  clip_id: string | null;
  type: "extract_audio" | "find_moments" | "generate_clips";
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  original_video_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  content_type: string | null;
  requested_clip_count: number | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface Transcript {
  text: string;
  words: TranscriptWord[];
}

export interface MomentCandidate {
  start_time: number;
  end_time: number;
  title: string;
  hook: string;
  description: string;
  hashtags: string[];
  score: number;
  hook_score: number;
  entertainment_score: number;
  emotion_score: number;
  context_score: number;
  shareability_score: number;
}
