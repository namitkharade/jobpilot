import {
  getCoverLetterCacheStatus,
  loadTailoredCoverLetter,
  saveCoverLetterCache,
} from "@/lib/openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get("jobId");
  const base = getCoverLetterCacheStatus();

  if (!jobId) {
    return NextResponse.json({
      success: true,
      data: {
        ...base,
        tailoredText: null,
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      ...base,
      tailoredText: loadTailoredCoverLetter(jobId),
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { coverLetterText?: unknown };
    const coverLetterText = typeof body.coverLetterText === "string" ? body.coverLetterText : "";

    if (!coverLetterText.trim()) {
      return NextResponse.json(
        { success: false, error: "coverLetterText is required" },
        { status: 400 }
      );
    }

    saveCoverLetterCache(coverLetterText);

    return NextResponse.json({
      success: true,
      data: {
        characterCount: coverLetterText.length,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save cover letter";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
