import { compileTex } from "@/lib/latex";
import { loadResumeCache, loadTailoredResume } from "@/lib/openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface CompileRequestBody {
  texSource?: string;
  jobId?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompileRequestBody;
    let source: string | null = null;

    if (body.texSource) {
      source = body.texSource;
    } else if (body.jobId) {
      source = loadTailoredResume(body.jobId);
      if (!source) {
        return NextResponse.json({ success: false, error: "Tailored resume not found" }, { status: 404 });
      }
    } else {
      source = loadResumeCache();
      if (!source) {
        return NextResponse.json({ success: false, error: "No resume found" }, { status: 400 });
      }
    }

    const pdfBuffer = await compileTex(source);

    return NextResponse.json({
      success: true,
      pdfBase64: pdfBuffer.toString("base64"),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Compilation failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
