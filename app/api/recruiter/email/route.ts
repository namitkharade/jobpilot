import { getAllJobs, updateJob } from "@/lib/job-store";
import { normalizeJobListing, normalizeRecruiterCandidate } from "@/lib/job-normalize";
import { runRecruiterResearch } from "@/lib/recruiter-intelligence";
import { RecruiterProfile } from "@/types";
import { NextResponse } from "next/server";

interface RecruiterEmailRequest {
  recruiterProfile?: RecruiterProfile;
  company?: string;
  jobId?: string;
  candidateId?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RecruiterEmailRequest;
    const { recruiterProfile, company, jobId, candidateId } = body;

    if (!jobId) {
      return NextResponse.json({ success: false, error: "Missing required field: jobId" }, { status: 400 });
    }

    const jobs = await getAllJobs();
    const existingJob = jobs.find((job) => job.id === jobId);
    if (!existingJob) {
      return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
    }

    let job = existingJob;
    let targetCandidateId = candidateId || "";

    if (!targetCandidateId && recruiterProfile) {
      const syntheticCandidate = normalizeRecruiterCandidate({
        name: recruiterProfile.name,
        title: recruiterProfile.title,
        linkedinUrl: recruiterProfile.linkedinUrl,
        email: recruiterProfile.email,
        emailConfidence: recruiterProfile.confidence,
        emailVerificationStatus: recruiterProfile.email ? "unverified" : "not_found",
        domainPattern: "",
        sourceTypes: ["manual"],
        sourceSummary: recruiterProfile.source || "Legacy recruiter email lookup",
        evidence: [],
      });

      targetCandidateId = syntheticCandidate.id;
      job = normalizeJobListing({
        ...existingJob,
        company: company || existingJob.company,
        recruiterCandidates: [
          ...existingJob.recruiterCandidates.filter((candidate) => candidate.id !== syntheticCandidate.id),
          syntheticCandidate,
        ],
      });
    }

    const { result, updates } = await runRecruiterResearch(job, {
      forceRefresh: true,
      candidateId: targetCandidateId || undefined,
    });

    await updateJob(jobId, updates);

    const candidate =
      result.candidates.find((entry) => entry.id === (targetCandidateId || result.selectedRecruiterId)) ||
      result.candidates[0];

    return NextResponse.json({
      success: true,
      data: {
        email: candidate?.email || "",
        confidence: candidate?.emailConfidence || 0,
        method: candidate?.email
          ? candidate.emailResolutionMethod === "hunter-enrichment" || candidate.emailResolutionMethod === "existing"
            ? "hunter-domain"
            : candidate.emailResolutionMethod === "pattern-verified"
              ? "pattern-verified"
              : "hunter-direct"
          : "not-found",
        verified: candidate?.emailVerificationStatus === "valid",
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
