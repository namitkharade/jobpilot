import { updateJob, getAllJobs } from "@/lib/job-store";
import { normalizeJobListing } from "@/lib/job-normalize";
import { runRecruiterResearch } from "@/lib/recruiter-intelligence";
import { JobListing, RecruiterResearchResult } from "@/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface RecruiterRequestBody {
  jobId: string;
  company?: string;
  role?: string;
  jobDescription?: string;
  applyUrl?: string;
  companyDescription?: string;
  forceRefresh?: boolean;
  candidateId?: string;
}

function buildJobFromRequest(body: RecruiterRequestBody, existingJob?: JobListing | null): JobListing {
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
    id: body.jobId,
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
    const body = (await request.json()) as RecruiterRequestBody;
    const { jobId, forceRefresh, candidateId } = body;

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: "Missing required field: jobId" },
        { status: 400 }
      );
    }

    const jobs = await getAllJobs();
    const existingJob = jobs.find((job) => job.id === jobId) || null;
    const job = buildJobFromRequest(body, existingJob);

    if (!job.company || !job.title || !job.jobDescription) {
      return NextResponse.json(
        { success: false, error: "Company, role, and job description are required for recruiter research" },
        { status: 400 }
      );
    }

    const { result, updates } = await runRecruiterResearch(job, {
      forceRefresh,
      candidateId,
    });

    if (existingJob) {
      await updateJob(jobId, updates);
    }

    return NextResponse.json({
      success: true,
      data: result as RecruiterResearchResult,
    });
  } catch (error: unknown) {
    console.error("Recruiter research route failed:", error);
    const message = error instanceof Error ? error.message : "Failed to research recruiter contacts";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
