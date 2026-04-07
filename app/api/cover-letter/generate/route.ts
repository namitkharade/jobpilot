import { buildCoverLetterTex } from "@/lib/cover-letter";
import { getAllJobs } from "@/lib/job-store";
import { getConfig } from "@/lib/local-store";
import {
  getCoverLetterDocument,
  getResumeTextForPrompt,
  looksLikeTex,
  saveTailoredCoverLetter,
} from "@/lib/openai";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are an expert career writing assistant who writes cover letters directly in LaTeX. Return only the final LaTeX source for a complete cover letter document. Preserve the existing template structure when a base cover letter template is supplied. Do not use markdown fences.`;

function sanitizeFileSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "job";
}

function buildPrompt(args: {
  baseCoverLetterTex: string;
  hasBaseTemplate: boolean;
  resumeText: string;
  jobDescription: string;
  companyDescription: string;
  title: string;
  company: string;
}) {
  const defaultTemplate = buildCoverLetterTex("Dear Hiring Team,\n\nWrite the tailored letter body here.\n\nSincerely,\nCandidate");

  return [
    args.hasBaseTemplate
      ? "Adapt the provided BASE COVER LETTER LATEX template for this specific role while preserving its structure and styling."
      : "Create a new tailored LaTeX cover letter using the provided DEFAULT LATEX TEMPLATE as the structure.",
    `Role: ${args.title}`,
    `Company: ${args.company}`,
    `Job description:\n${args.jobDescription}`,
    `Company description:\n${args.companyDescription || "Not provided"}`,
    `Resume context:\n${args.resumeText}`,
    `Base cover letter template:\n${args.baseCoverLetterTex || "Not provided"}`,
    `Default template:\n${defaultTemplate}`,
    `Requirements:
- Return complete valid LaTeX for the entire document.
- Keep a professional greeting and sign-off.
- Mention 2-3 concrete skills or experiences from the resume context.
- Do not invent employers, metrics, or tools not supported by the resume context.
- If a base template is supplied, preserve its layout and command structure as much as possible.
- Return only LaTeX.`,
  ].join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { jobId?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";

    if (!jobId) {
      return NextResponse.json({ success: false, error: "jobId is required" }, { status: 400 });
    }

    const jobs = await getAllJobs();
    const job = jobs.find((item) => item.id === jobId);
    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
    }

    const resumeText = getResumeTextForPrompt(job.id) || getResumeTextForPrompt();
    if (!resumeText.trim()) {
      return NextResponse.json({ success: false, error: "No resume template found in cache" }, { status: 400 });
    }

    const baseCoverLetter = getCoverLetterDocument();
    const baseCoverLetterTex = baseCoverLetter?.texSource
      ? looksLikeTex(baseCoverLetter.texSource)
        ? baseCoverLetter.texSource
        : buildCoverLetterTex(baseCoverLetter.texSource)
      : "";

    const config = getConfig();
    const apiKey = config.apiKeys.openai;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "OpenAI API key is missing in configuration" },
        { status: 400 }
      );
    }

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: buildPrompt({
            baseCoverLetterTex,
            hasBaseTemplate: Boolean(baseCoverLetterTex.trim()),
            resumeText,
            jobDescription: job.jobDescription || "",
            companyDescription: job.companyDescription || "",
            title: job.title,
            company: job.company,
          }),
        },
      ],
      max_tokens: 2500,
    });

    const coverLetterText = completion.choices[0]?.message?.content?.trim() || "";
    if (!coverLetterText) {
      return NextResponse.json(
        { success: false, error: "Model returned an empty cover letter" },
        { status: 500 }
      );
    }

    const fileName = `${sanitizeFileSegment(job.company)}-${sanitizeFileSegment(job.title)}-cover-letter.tex`;
    saveTailoredCoverLetter(jobId, coverLetterText, { fileName });

    return NextResponse.json({
      success: true,
      data: {
        coverLetterText,
        fileName,
        usedBaseCoverLetter: Boolean(baseCoverLetterTex.trim()),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate cover letter";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
