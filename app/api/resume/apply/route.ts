import { getAllJobs } from "@/lib/job-store";
import { loadResumeCache, saveTailoredResume } from "@/lib/openai";
import { AtsSuggestion } from "@/types";
import { diffWords } from "@/utils/diff";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function rebuildSuggestedText(original: string, suggested: string): string {
  const parts = diffWords(original, suggested);
  return parts.filter((part) => !part.removed).map((part) => part.value).join("");
}

function applySuggestionToResume(resumeText: string, suggestion: AtsSuggestion): string {
  const original = suggestion.original || "";
  const replacement = rebuildSuggestedText(original, suggestion.suggested || "");

  if (!original.trim()) {
    return suggestion.bulletIndex === -1 && replacement.trim()
      ? `${resumeText}\n${replacement}`
      : resumeText;
  }

  if (resumeText.includes(original)) {
    return resumeText.split(original).join(replacement);
  }

  if (suggestion.bulletIndex === -1 && replacement.trim()) {
    return `${resumeText}\n${replacement}`;
  }

  return resumeText;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { jobId?: unknown; suggestionIndex?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    const suggestionIndex =
      typeof body.suggestionIndex === "number" && Number.isInteger(body.suggestionIndex)
        ? body.suggestionIndex
        : null;

    if (!jobId.trim()) {
      return NextResponse.json(
        { success: false, error: "jobId is required" },
        { status: 400 }
      );
    }

    const baseResume = loadResumeCache();
    if (!baseResume?.trim()) {
      return NextResponse.json(
        { success: false, error: "No base resume found in cache" },
        { status: 400 }
      );
    }

    const jobs = await getAllJobs();
    const job = jobs.find((item) => item.id === jobId);

    if (!job) {
      return NextResponse.json({ success: false, error: "Job not found" }, { status: 404 });
    }

    const suggestions = Array.isArray(job.atsSuggestions) ? job.atsSuggestions : [];

    if (!suggestions.length) {
      return NextResponse.json(
        { success: false, error: "No ATS suggestions found for this job" },
        { status: 400 }
      );
    }

    const targetedSuggestions =
      suggestionIndex === null
        ? suggestions
        : suggestionIndex >= 0 && suggestionIndex < suggestions.length
          ? [suggestions[suggestionIndex]]
          : null;

    if (!targetedSuggestions) {
      return NextResponse.json(
        { success: false, error: "Invalid suggestionIndex" },
        { status: 400 }
      );
    }

    const tailoredResume = targetedSuggestions.reduce((currentText, suggestion) => {
      return applySuggestionToResume(currentText, suggestion);
    }, baseResume);

    saveTailoredResume(jobId, tailoredResume);

    return NextResponse.json({
      success: true,
      data: {
        tailoredResume,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to apply ATS suggestions";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
