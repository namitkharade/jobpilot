import { getResumeCachePath, getResumeCacheStatus } from "@/lib/openai";
import fs from "fs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const status = getResumeCacheStatus();

  return NextResponse.json({
    success: true,
    data: {
      loaded: status.loaded,
      characterCount: status.characterCount,
      text: status.text,
      updatedAt: status.updatedAt,
    },
  });
}

export async function DELETE() {
  try {
    const path = getResumeCachePath();
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }

    return NextResponse.json({
      success: true,
      data: {
        loaded: false,
        characterCount: 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clear resume";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
