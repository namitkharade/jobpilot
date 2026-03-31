import { getAllJobs } from "@/lib/job-store";
import { getConfig } from "@/lib/local-store";
import {
    getCoverLetterCacheStatus,
    loadResumeCache,
    saveTailoredCoverLetter,
} from "@/lib/openai";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are an expert career writing assistant. Write concise, specific, and credible cover letters in plain text. No markdown. Avoid placeholders. Keep a professional and confident tone.`;

function buildPrompt(args: {
  baseCoverLetter: string;
  resumeText: string;
  jobDescription: string;
  companyDescription: string;
  title: string;
  company: string;
}) {
  const instruction = args.baseCoverLetter.trim()
    ? "Refine and adapt the provided BASE COVER LETTER for this role. Keep useful details and rewrite weak parts."
    : "Create a new role-specific cover letter from scratch.";

  return `${instruction}

Role: ${args.title}
Company: ${args.company}

JOB DESCRIPTION:
${args.jobDescription}

COMPANY DESCRIPTION:
${args.companyDescription || "Not provided"}

RESUME SUMMARY/CV CONTENT:
${args.resumeText}

BASE COVER LETTER (optional):
${args.baseCoverLetter || "Not provided"}

Output requirements:
- Return only the final cover letter text.
- 250-450 words.
- Include greeting and sign-off.
- Mention 2-3 concrete experiences/skills aligned to the job.
- Do not invent tools, achievements, or numbers not present in the resume context.
- No markdown, no bullet list.`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { jobId?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";

    if (!jobId.trim()) {
      return NextResponse.json({ success: false, error: "jobId is required" }, { status: 400 });
    }

    const jobs = await getAllJobs();
    const job = jobs.find((item) => item.id === jobId);
    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
    }

    const resumeText = loadResumeCache();
    if (!resumeText?.trim()) {
      return NextResponse.json({ success: false, error: "No base resume found in cache" }, { status: 400 });
    }

    const baseCoverLetter = getCoverLetterCacheStatus().text;

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
            baseCoverLetter,
            resumeText,
            jobDescription: job.jobDescription || "",
            companyDescription: job.companyDescription || "",
            title: job.title,
            company: job.company,
          }),
        },
      ],
      max_tokens: 1200,
    });

    const coverLetterText = completion.choices[0]?.message?.content?.trim() || "";
    if (!coverLetterText) {
      return NextResponse.json(
        { success: false, error: "Model returned an empty cover letter" },
        { status: 500 }
      );
    }

    saveTailoredCoverLetter(jobId, coverLetterText);

    return NextResponse.json({
      success: true,
      data: {
        coverLetterText,
        usedBaseCoverLetter: Boolean(baseCoverLetter.trim()),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate cover letter";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
