import { getAllJobs } from "@/lib/job-store";
import { getConfig } from "@/lib/local-store";
import { loadResumeCache } from "@/lib/openai";
import { searchWeb } from "@/lib/searxng";
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type AssistantHistoryRole = "user" | "assistant";

interface AssistantHistoryMessage {
  role: AssistantHistoryRole;
  content: string;
}

interface AssistantRequestBody {
  jobId?: unknown;
  question?: unknown;
  history?: unknown;
}

function normalizeHistory(history: unknown): AssistantHistoryMessage[] {
  if (!Array.isArray(history)) {
    return [];
  }

  const parsed = history
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const maybeRole = (item as { role?: unknown }).role;
      const maybeContent = (item as { content?: unknown }).content;

      if ((maybeRole !== "user" && maybeRole !== "assistant") || typeof maybeContent !== "string") {
        return null;
      }

      const content = maybeContent.trim();
      if (!content) {
        return null;
      }

      return { role: maybeRole, content };
    })
    .filter((item): item is AssistantHistoryMessage => item !== null);

  return parsed.slice(-12);
}

function buildSystemPrompt(args: {
  jobTitle: string;
  company: string;
  jobDescription: string;
  companyDescription: string;
  companyContext: string;
  resumeText: string;
}) {
  const shortDescription = args.jobDescription.slice(0, 2000);
  const companyContext = args.companyContext || "Not available";
  const companyDescription = args.companyDescription || "Not available";

  return `You are a professional job application assistant helping the user apply for the following role.
Role
${args.jobTitle} at ${args.company}
Job Description
${shortDescription}
Company Context
${companyContext}
Company Description
${companyDescription}
Candidate Resume
${args.resumeText}
Your task: When the user pastes a question from a job application form, write a concise, professional, first-person answer on their behalf. The answer should be truthful based on the resume, tailored to the job, and ready to copy-paste into the form. Do not add any preamble or meta-commentary - output only the answer text itself.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AssistantRequestBody;
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const history = normalizeHistory(body.history);

    if (!jobId || !question) {
      return NextResponse.json(
        { success: false, error: "Missing jobId or question" },
        { status: 400 }
      );
    }

    const config = getConfig();
    const apiKey = config.apiKeys.openai;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "OpenAI API key not configured" },
        { status: 400 }
      );
    }

    const resumeText = loadResumeCache();
    if (!resumeText || !resumeText.trim()) {
      return NextResponse.json(
        { success: false, error: "No resume found. Please upload your resume first." },
        { status: 400 }
      );
    }

    const jobs = await getAllJobs();
    const job = jobs.find((item) => item.id === jobId);

    if (!job) {
      return NextResponse.json(
        { success: false, error: "Job not found" },
        { status: 404 }
      );
    }

    let companyContext = "";
    try {
      const results = await searchWeb(`${job.company} company overview`, 1);
      companyContext = results[0]?.snippet || "";
    } catch {
      companyContext = "";
    }

    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: buildSystemPrompt({
            jobTitle: job.title,
            company: job.company,
            jobDescription: job.jobDescription || "",
            companyDescription: job.companyDescription || "",
            companyContext,
            resumeText,
          }),
        },
        ...history,
        { role: "user", content: question },
      ],
      max_tokens: 600,
    });

    const answer = (response.choices[0]?.message?.content || "").trim();
    if (!answer) {
      return NextResponse.json(
        { success: false, error: "No answer generated" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        answer,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Assistant request failed";
    console.error("Assistant API error:", error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
