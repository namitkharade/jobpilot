import { saveResumeCache } from "@/lib/openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { resumeText?: unknown };
    const resumeText = typeof body.resumeText === "string" ? body.resumeText : "";

    if (!resumeText.trim()) {
      return NextResponse.json(
        { success: false, error: "resumeText is required" },
        { status: 400 }
      );
    }

    saveResumeCache(resumeText);

    return NextResponse.json({
      success: true,
      data: {
        characterCount: resumeText.length,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save resume";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
