import { appendJobs, deleteJob, getAllJobs, updateJob } from "@/lib/job-store";
import { normalizeJobListing } from "@/lib/job-normalize";
import { JobListing } from "@/types";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  try {
    const jobs = await getAllJobs();
    return NextResponse.json({ success: true, data: jobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch jobs";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawJob = (await req.json()) as Partial<JobListing>;
    const job = normalizeJobListing({
      ...rawJob,
      id: rawJob.id || `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });
    await appendJobs([job]);
    return NextResponse.json({ success: true, data: job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add job";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const updates = (await req.json()) as Partial<JobListing>;
    if (!updates.id) {
      return NextResponse.json({ success: false, error: "Missing job id" }, { status: 400 });
    }
    await updateJob(updates.id, updates);
    return NextResponse.json({ success: true, data: updates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update job";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ success: false, error: "Missing job id" }, { status: 400 });
    }
    await deleteJob(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete job";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
