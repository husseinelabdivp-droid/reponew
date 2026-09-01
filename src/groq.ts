import Groq from "groq-sdk";

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  throw new Error("Missing GROQ_API_KEY environment variable");
}

export const groq = new Groq({ apiKey });

// Free-tier models on Groq (as of writing) — swap here if these change.
export const WHISPER_MODEL = "whisper-large-v3-turbo";
export const LLM_MODEL = "llama-3.3-70b-versatile";
