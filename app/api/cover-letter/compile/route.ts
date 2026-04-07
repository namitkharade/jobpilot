import { buildCoverLetterTex } from "@/lib/cover-letter";
import { compileTex } from "@/lib/latex";
import {
    getCoverLetterDocument,
    looksLikeTex,
} from "@/lib/openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface CompileCoverLetterRequest {
  coverLetterText?: string;
  jobId?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompileCoverLetterRequest;

    let content = "";
    if (body.coverLetterText?.trim()) {
      content = body.coverLetterText;
    } else if (body.jobId?.trim()) {
      content = getCoverLetterDocument(body.jobId)?.texSource || getCoverLetterDocument()?.texSource || "";
    } else {
      content = getCoverLetterDocument()?.texSource || "";
    }

    if (!content.trim()) {
      return NextResponse.json(
        { success: false, error: "No cover letter content found" },
        { status: 400 }
      );
    }

    const tex = looksLikeTex(content) ? content : buildCoverLetterTex(content);
    const pdfBuffer = await compileTex(tex);

    return NextResponse.json({
      success: true,
      pdfBase64: pdfBuffer.toString("base64"),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Compilation failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
