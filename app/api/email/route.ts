import { generateOutreach } from "@/lib/outreach";
import { getAllJobs, updateJob } from "@/lib/job-store";
import { normalizeJobListing, normalizeRecruiterCandidate } from "@/lib/job-normalize";
import { JobListing, RecruiterProfile } from "@/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface LegacyEmailRequest {
  jobId?: string;
  recruiter?: RecruiterProfile;
  jobListing?: JobListing;
  resumeSummary?: string;
  tone?: "professional" | "conversational" | "direct";
  variant?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LegacyEmailRequest;
    const { jobId, recruiter, jobListing, tone } = body;

    const effectiveJobId = jobId || jobListing?.id;
    if (!effectiveJobId) {
      return NextResponse.json({ success: false, error: "Missing required field: jobId" }, { status: 400 });
    }

    const jobs = await getAllJobs();
    const existingJob = jobs.find((job) => job.id === effectiveJobId);
    const baseJob = existingJob || (jobListing ? normalizeJobListing(jobListing) : null);

    if (!baseJob) {
      return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
    }

    let job = baseJob;
    let candidateId = "";

    if (recruiter) {
      const matchedCandidate = job.recruiterCandidates.find(
        (candidate) =>
          candidate.linkedinUrl === recruiter.linkedinUrl ||
          candidate.email === recruiter.email ||
          `${candidate.name}|${candidate.title}`.toLowerCase() === `${recruiter.name}|${recruiter.title}`.toLowerCase()
      );

      if (matchedCandidate) {
        candidateId = matchedCandidate.id;
      } else {
        const syntheticCandidate = normalizeRecruiterCandidate({
          name: recruiter.name,
          title: recruiter.title,
          linkedinUrl: recruiter.linkedinUrl,
          email: recruiter.email,
          emailConfidence: recruiter.confidence,
          emailVerificationStatus: recruiter.email ? "unverified" : "not_found",
          domainPattern: "",
          sourceTypes: ["manual"],
          sourceSummary: recruiter.source || "Legacy email generation request",
          evidence: [],
        });

        candidateId = syntheticCandidate.id;
        job = normalizeJobListing({
          ...job,
          recruiterCandidates: [
            ...job.recruiterCandidates.filter((candidate) => candidate.id !== syntheticCandidate.id),
            syntheticCandidate,
          ],
          selectedRecruiterId: syntheticCandidate.id,
        });
      }
    }

    const { response, updates } = await generateOutreach(job, {
      candidateId: candidateId || job.selectedRecruiterId || undefined,
      preferredChannel: "email",
      tones: ["professional", "conversational", "direct"],
      forceRefreshBrief: false,
      forceRegenerateDrafts: true,
    });

    if (existingJob) {
      await updateJob(baseJob.id, updates);
    }

    if (response.preferredChannel !== "email" || response.drafts.length === 0) {
      return NextResponse.json(
        { success: false, error: "No verified email channel available for this contact" },
        { status: 422 }
      );
    }

    const byTone = response.drafts.map((draft) => ({
      subject: draft.subject,
      body: draft.body,
      wordCount: draft.wordCount,
      hookType: draft.hookType,
      callToAction: draft.cta,
      _tone: draft.tone,
    }));

    const preferredFirst = tone
      ? [
          ...byTone.filter((item) => item._tone === tone),
          ...byTone.filter((item) => item._tone !== tone),
        ]
      : byTone;

    return NextResponse.json({
      success: true,
      data: preferredFirst,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate email";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
