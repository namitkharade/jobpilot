import { getAllJobs } from "@/lib/job-store";
import { getConfig } from "@/lib/local-store";
import { getResumeDocument, saveTailoredResume } from "@/lib/openai";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are an expert resume writer who edits resumes in LaTeX. You receive a base resume template in valid LaTeX plus ATS findings for a specific role. Return a complete revised LaTeX document that preserves the overall document structure, keeps existing valid commands/macros when possible, and improves the content for this job. Do not use markdown fences. Do not explain your work. Return only the final LaTeX source.`;

function sanitizeFileSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "job";
}

function buildPrompt(args: {
  baseResumeTex: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
  atsScore: number | null;
  keywordGaps: string[];
  suggestions: Array<{
    section: string;
    original: string;
    suggested: string;
    reason: string;
    keywordsAdded: string[];
  }>;
}) {
  return [
    `Role: ${args.jobTitle}`,
    `Company: ${args.company}`,
    `ATS score: ${args.atsScore ?? "Not available"}`,
    `Missing keywords: ${args.keywordGaps.join(", ") || "None provided"}`,
    `ATS guidance:`,
    args.suggestions.length
      ? args.suggestions
          .map(
            (suggestion, index) =>
              `${index + 1}. [${suggestion.section}] ${suggestion.reason}\nOriginal: ${suggestion.original}\nSuggested direction: ${suggestion.suggested}\nKeywords: ${suggestion.keywordsAdded.join(", ") || "None"}`
          )
          .join("\n\n")
      : "No detailed ATS suggestions were provided. Improve the resume using the job description alone.",
    `Job description:\n${args.jobDescription}`,
    `Base resume TeX:\n${args.baseResumeTex}`,
    `Requirements:
- Return complete valid LaTeX, not a fragment.
- Preserve the existing template structure and commands unless a change is necessary for correctness.
- Tailor bullets, summary, and skills to this role using truthful language only.
- Do not invent employers, titles, dates, metrics, or tools that are not supported by the base resume.
- Keep the output concise and job-specific.
- Return only LaTeX.`,
  ].join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { jobId?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: "jobId is required" },
        { status: 400 }
      );
    }

    const baseResume = getResumeDocument();
    if (!baseResume?.texSource.trim()) {
      return NextResponse.json(
        { success: false, error: "No base resume template found" },
        { status: 400 }
      );
    }

    const jobs = await getAllJobs();
    const job = jobs.find((item) => item.id === jobId);

    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
    }

    if (job.atsScore === null && (!job.atsSuggestions?.length || !job.atsKeywordGaps?.length)) {
      return NextResponse.json(
        { success: false, error: "Run ATS analysis before generating a job-specific CV draft" },
        { status: 400 }
      );
    }

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
            baseResumeTex: baseResume.texSource,
            jobTitle: job.title,
            company: job.company,
            jobDescription: job.jobDescription || "",
            atsScore: job.atsScore,
            keywordGaps: job.atsKeywordGaps || [],
            suggestions: job.atsSuggestions || [],
          }),
        },
      ],
      max_tokens: 4000,
    });

    const tailoredResume = completion.choices[0]?.message?.content?.trim() || "";
    if (!tailoredResume) {
      return NextResponse.json(
        { success: false, error: "Model returned an empty resume draft" },
        { status: 500 }
      );
    }

    const fileName = `${sanitizeFileSegment(job.company)}-${sanitizeFileSegment(job.title)}-resume.tex`;
    saveTailoredResume(jobId, tailoredResume, { fileName });

    return NextResponse.json({
      success: true,
      data: {
        tailoredResume,
        fileName,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate tailored resume";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
