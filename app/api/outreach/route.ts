import { generateOutreach } from "@/lib/outreach";
import { getAllJobs, updateJob } from "@/lib/job-store";
import { OutreachResponseData } from "@/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface OutreachRequestBody {
  jobId: string;
  candidateId?: string;
  preferredChannel?: "email" | "linkedin";
  tones?: Array<"professional" | "conversational" | "direct">;
  forceRefreshBrief?: boolean;
  forceRegenerateDrafts?: boolean;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OutreachRequestBody;
    if (!body.jobId) {
      return NextResponse.json({ success: false, error: "Missing required field: jobId" }, { status: 400 });
    }

    const jobs = await getAllJobs();
    const job = jobs.find((entry) => entry.id === body.jobId);
    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
    }

    const { response, updates } = await generateOutreach(job, {
      candidateId: body.candidateId,
      preferredChannel: body.preferredChannel,
      tones: body.tones,
      forceRefreshBrief: body.forceRefreshBrief,
      forceRegenerateDrafts: body.forceRegenerateDrafts,
    });

    await updateJob(job.id, updates);

    return NextResponse.json({
      success: true,
      data: response as OutreachResponseData,
    });
  } catch (error: unknown) {
    console.error("Outreach generation failed:", error);
    const message = error instanceof Error ? error.message : "Failed to generate outreach";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
