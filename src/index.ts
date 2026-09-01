import "dotenv/config";
import { supabase } from "./supabase.js";
import { extractAndTranscribe } from "./pipeline/extractAudio.js";
import { findMoments } from "./pipeline/findMoments.js";
import { generateClips } from "./pipeline/generateClips.js";
import type { Project, ProcessingJob, Transcript, MomentCandidate } from "./types.js";

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 5000);

async function claimNextJob(): Promise<ProcessingJob | null> {
  const { data: jobs, error } = await supabase
    .from("processing_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("Failed to fetch queued jobs:", error.message);
    return null;
  }
  if (!jobs || jobs.length === 0) return null;

  const job = jobs[0] as ProcessingJob;

  // Claim it (naive — fine for a single worker instance; if you ever run
  // multiple worker instances, switch this to an atomic UPDATE ... WHERE status='queued').
  const { error: claimError } = await supabase
    .from("processing_jobs")
    .update({ status: "processing", progress: 0, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued");

  if (claimError) {
    console.error("Failed to claim job:", claimError.message);
    return null;
  }

  return job;
}

async function markJob(
  jobId: string,
  fields: Partial<Pick<ProcessingJob, "status" | "progress" | "error">>
) {
  await supabase
    .from("processing_jobs")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function getProject(projectId: string): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (error || !data) throw new Error(`Failed to load project ${projectId}: ${error?.message}`);
  return data as Project;
}

async function queueNextStage(
  projectId: string,
  nextType: "find_moments" | "generate_clips"
) {
  const { error } = await supabase.from("processing_jobs").insert({
    project_id: projectId,
    type: nextType,
    status: "queued",
    progress: 0,
  });
  if (error) throw new Error(`Failed to queue ${nextType} job: ${error.message}`);
}

// Transcript/moments need to pass between stages. Simplest approach: stash them in
// memory keyed by project — fine since this single worker processes jobs sequentially.
// If you ever scale to multiple worker instances, persist these to a table/column instead.
const transcriptCache = new Map<string, Transcript>();
const momentsCache = new Map<string, MomentCandidate[]>();

async function processJob(job: ProcessingJob) {
  console.log(`Processing job ${job.id} (${job.type}) for project ${job.project_id}`);
  const project = await getProject(job.project_id);

  try {
    if (job.type === "extract_audio") {
      const transcript = await extractAndTranscribe(project);
      transcriptCache.set(project.id, transcript);
      await markJob(job.id, { status: "completed", progress: 100 });
      await queueNextStage(project.id, "find_moments");
    } else if (job.type === "find_moments") {
      let transcript = transcriptCache.get(project.id);
      if (!transcript) {
        // Worker restarted between stages — re-derive by re-transcribing.
        transcript = await extractAndTranscribe(project);
      }
      const moments = await findMoments(project, transcript);
      momentsCache.set(project.id, moments);
      await markJob(job.id, { status: "completed", progress: 100 });
      await queueNextStage(project.id, "generate_clips");
    } else if (job.type === "generate_clips") {
      const moments = momentsCache.get(project.id);
      if (!moments) {
        throw new Error(
          "No cached moments found for generate_clips — worker likely restarted mid-pipeline. Re-run find_moments."
        );
      }
      await generateClips(project, moments);
      await markJob(job.id, { status: "completed", progress: 100 });

      await supabase
        .from("projects")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", project.id);

      transcriptCache.delete(project.id);
      momentsCache.delete(project.id);
    }
  } catch (err: any) {
    console.error(`Job ${job.id} failed:`, err);
    await markJob(job.id, { status: "failed", error: String(err.message ?? err) });
    await supabase
      .from("projects")
      .update({ status: "failed", error: String(err.message ?? err) })
      .eq("id", project.id);
  }
}

async function loop() {
  const job = await claimNextJob();
  if (job) {
    await processJob(job);
  }
  setTimeout(loop, POLL_INTERVAL_MS);
}

console.log("ClipForge worker started, polling for jobs...");
loop();
