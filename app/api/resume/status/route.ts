import { clearResumeCache, getResumeDocumentStatus } from "@/lib/openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const status = getResumeDocumentStatus();

  return NextResponse.json({
    success: true,
    data: {
      ...status,
    },
  });
}

export async function DELETE() {
  try {
    clearResumeCache();

    return NextResponse.json({
      success: true,
      data: {
        loaded: false,
        characterCount: 0,
        text: "",
        texSource: "",
        fileName: null,
        updatedAt: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear resume";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
