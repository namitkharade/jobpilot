import { importJobFromUrl, JobImportError } from "@/lib/job-import";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: unknown };
    const url = typeof body.url === "string" ? body.url : "";

    if (!url.trim()) {
      return NextResponse.json({ success: false, error: "Missing job URL" }, { status: 400 });
    }

    const result = await importJobFromUrl(url);

    return NextResponse.json({
      success: true,
      data: result.data,
      warnings: result.warnings,
      extractedVia: result.extractedVia,
    });
  } catch (error) {
    const status = error instanceof JobImportError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to import job from URL";
    console.error("Job import route error:", error);

    return NextResponse.json({ success: false, error: message }, { status });
  }
}
