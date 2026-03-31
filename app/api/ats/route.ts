import { getAllJobs, updateJob } from "@/lib/job-store";
import { getConfig } from "@/lib/local-store";
import { loadResumeCache, loadTailoredResume } from "@/lib/openai";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

// Remove global client to ensure we always use the latest config-based API key
// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

const SYSTEM_PROMPT = `You are an expert ATS (Applicant Tracking System) analyst and resume coach with 15 years of experience in technical recruiting. Your job is to deeply analyze the match between a resume and a job description. You always respond in valid JSON only. Respond with ONLY a valid JSON object.`;

function buildUserPrompt(resumeText: string, jobDescription: string) {
  return `Analyze the ATS match between the following resume and job description.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

Respond with ONLY this JSON structure:
{
  "score": <number 0-100>,
  "matchedKeywords": [<string array>],
  "missingKeywords": [<string array>],
  "suggestions": [
    {
      "section": <"summary"|"experience"|"skills"|"education">,
      "bulletIndex": <number>,
      "original": <string>,
      "suggested": <string>,
      "reason": <string>,
      "keywordsAdded": [<string array>]
    }
  ],
  "scoreBreakdown": {
    "keywordMatch": <number 0-100>,
    "skillsAlignment": <number 0-100>,
    "experienceRelevance": <number 0-100>,
    "formatQuality": <number 0-100>
  },
  "topMissingSkills": [<string array>],
  "summary": <string>
}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { jobId?: unknown; jobDescription?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    const jobDescription = typeof body.jobDescription === "string" ? body.jobDescription : "";

    if (!jobId || !jobDescription) {
      return NextResponse.json(
        { success: false, error: "Missing jobId or jobDescription" },
        { status: 400 }
      );
    }

    const finalResumeText = loadTailoredResume(jobId) || loadResumeCache();

    if (!finalResumeText) {
      return NextResponse.json(
        { success: false, error: "No resume text found in cache" },
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

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(finalResumeText, jobDescription) }
      ],
      max_tokens: 2000
    });

    const text = response.choices[0].message.content ?? "";
    const result = JSON.parse(text);

    await updateJob(jobId, {
      atsScore: result.score,
      atsKeywordGaps: result.missingKeywords,
      atsSuggestions: result.suggestions,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to score ATS";
    console.error("ATS Error:", error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: "Missing jobId" },
        { status: 400 }
      );
    }

    const jobs = await getAllJobs();
    const job = jobs.find((j) => j.id === jobId);

    if (!job) {
      return NextResponse.json(
        { success: false, error: "Job not found" },
        { status: 404 }
      );
    }

    if (job.atsScore === null || job.atsScore === undefined) {
      return NextResponse.json(
        { success: false, error: "No score computed for this job yet" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        score: job.atsScore,
        missingKeywords: job.atsKeywordGaps,
        suggestions: job.atsSuggestions,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch ATS score";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
