import { buildCoverLetterTex } from "@/lib/cover-letter";
import {
  getCoverLetterDocument,
  getCoverLetterDocumentStatus,
  looksLikeTex,
  saveCoverLetterCache,
  saveTailoredCoverLetter,
} from "@/lib/openai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function normalizeJobId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getEditorSource(jobId?: string) {
  const document = getCoverLetterDocument(jobId);
  if (!document) {
    return null;
  }

  if (!looksLikeTex(document.texSource) && document.fileName.endsWith(".txt")) {
    return {
      ...document,
      texSource: buildCoverLetterTex(document.texSource),
      fileName: document.fileName.replace(/\.txt$/i, ".tex"),
    };
  }

  return document;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = normalizeJobId(searchParams.get("jobId"));
  const document = getEditorSource(jobId || undefined);
  const status = getCoverLetterDocumentStatus(jobId || undefined);

  return NextResponse.json({
    success: true,
    data: {
      ...status,
      texSource: document?.texSource || "",
      text: document?.texSource || "",
      fileName: document?.fileName || null,
      jobId: jobId || null,
      hasJobSpecificDraft: Boolean(jobId && document?.texSource.trim()),
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      texSource?: unknown;
      fileName?: unknown;
      jobId?: unknown;
    };
    const texSource = typeof body.texSource === "string" ? body.texSource : "";
    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const jobId = normalizeJobId(body.jobId);

    if (!texSource.trim()) {
      return NextResponse.json(
        { success: false, error: "texSource is required" },
        { status: 400 }
      );
    }

    if (jobId) {
      saveTailoredCoverLetter(jobId, texSource, { fileName });
    } else {
      saveCoverLetterCache(texSource, { fileName });
    }

    const status = getCoverLetterDocumentStatus(jobId || undefined);

    return NextResponse.json({
      success: true,
      data: {
        ...status,
        jobId: jobId || null,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save cover letter";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
