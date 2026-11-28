// POST /api/ai/workflows/microbiome/resume-stages — bounded single-use recovery
// of pre-submission failures after discovery was incomplete. Resumes the SAME
// run with fresh live discovery; no upload, no job submission, no new run.
import { handleResumeStages } from "./engine.js";
export async function onRequest(context) {
  return handleResumeStages(context.request, context.env, { fetchImpl: context.env?.FETCH_IMPL });
}
