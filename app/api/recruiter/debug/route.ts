import { getAllJobs } from "@/lib/job-store";
import { normalizeJobListing } from "@/lib/job-normalize";
import { runRecruiterResearchDebug } from "@/lib/recruiter-intelligence";
import { JobListing } from "@/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface DebugRequestBody {
  jobId?: string;
  company?: string;
  role?: string;
  jobDescription?: string;
  applyUrl?: string;
  companyDescription?: string;
}

function buildJobFromRequest(body: DebugRequestBody, existingJob?: JobListing | null): JobListing {
  if (existingJob) {
    return normalizeJobListing({
      ...existingJob,
      company: body.company || existingJob.company,
      title: body.role || existingJob.title,
      jobDescription: body.jobDescription || existingJob.jobDescription,
      applyUrl: body.applyUrl || existingJob.applyUrl,
      companyDescription: body.companyDescription || existingJob.companyDescription,
    });
  }

  return normalizeJobListing({
    id: body.jobId || `debug_${Date.now()}`,
    company: body.company || "",
    title: body.role || "",
    jobDescription: body.jobDescription || "",
    applyUrl: body.applyUrl || "",
    companyDescription: body.companyDescription || "",
    postedAt: new Date().toISOString(),
    scrapedAt: new Date().toISOString(),
    status: "saved",
    source: "linkedin",
    location: "",
    salary: "",
    jobType: "",
    atsKeywordGaps: [],
    atsSuggestions: [],
    jobPosterName: "",
    jobPosterTitle: "",
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DebugRequestBody;
    const { jobId } = body;

    let existingJob: JobListing | null = null;
    if (jobId) {
      const jobs = await getAllJobs();
      existingJob = jobs.find((job) => job.id === jobId) || null;
    }

    const job = buildJobFromRequest(body, existingJob);

    if (!job.company) {
      return NextResponse.json(
        { success: false, error: "Company is required" },
        { status: 400 }
      );
    }

    const debugResult = await runRecruiterResearchDebug(job);

    return NextResponse.json({
      success: true,
      debug: {
        targetProfile: debugResult.targetProfile,
        providerStatus: debugResult.result.providerStatus,
        warnings: debugResult.result.warnings,
        debugSummary: debugResult.result.debugSummary,
        candidateCount: debugResult.result.candidates.length,
        selectedRecruiterId: debugResult.result.selectedRecruiterId,
        companyDomain: debugResult.result.companyDomain,
      },
    });
  } catch (error: unknown) {
    console.error("Debug recruiter research failed:", error);
    const message = error instanceof Error ? error.message : "Failed to debug recruiter research";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
