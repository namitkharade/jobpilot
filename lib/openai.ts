import fs from "fs";
import OpenAI from "openai";
import path from "path";

import { getConfig } from "./local-store";

// Remove global client to ensure we always use the latest config-based API key
// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

export interface GPTMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ResumeCacheData {
  resumeText: string;
  updatedAt: string;
  tailoredResumes: Record<string, { text: string; updatedAt: string }>;
  coverLetterText: string;
  coverLetterUpdatedAt: string;
  tailoredCoverLetters: Record<string, { text: string; updatedAt: string }>;
}

/** Send a prompt to GPT and get the text response. */
export async function askGPT(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<string> {
  const config = getConfig();
  const apiKey = config.apiKeys.openai;

  if (!apiKey) {
    throw new Error("OpenAI API key is missing in configuration.");
  }

  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: maxTokens,
  });

  return response.choices[0].message.content ?? "";
}

export function extractResumeText(latexSource: string): string {
  let text = latexSource;
  text = text.replace(/%.*$/gm, "");
  for (let i = 0; i < 5; i++) {
    text = text.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])*{([^{}]*)}/g, "$1");
  }
  text = text.replace(/\\begin{[^}]+}/g, "");
  text = text.replace(/\\end{[^}]+}/g, "");
  text = text.replace(/\\[a-zA-Z]+/g, "");
  text = text.replace(/\\[&%$#_{}~^]/g, (match) => match.charAt(1) || "");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n/g, "\n\n");
  return text.trim();
}

/** Resume caching logic */
export function getResumeCachePath() {
  return path.join(process.cwd(), ".resume-cache.json");
}

function readResumeCache(): ResumeCacheData {
  const p = getResumeCachePath();
  if (!fs.existsSync(p)) {
    return {
      resumeText: "",
      updatedAt: "",
      tailoredResumes: {},
      coverLetterText: "",
      coverLetterUpdatedAt: "",
      tailoredCoverLetters: {},
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as
      | Partial<ResumeCacheData>
      | { resumeText?: string };

    return {
      resumeText: typeof raw.resumeText === "string" ? raw.resumeText : "",
      updatedAt: typeof (raw as Partial<ResumeCacheData>).updatedAt === "string" ? (raw as Partial<ResumeCacheData>).updatedAt || "" : "",
      tailoredResumes:
        (raw as Partial<ResumeCacheData>).tailoredResumes &&
        typeof (raw as Partial<ResumeCacheData>).tailoredResumes === "object"
          ? (raw as Partial<ResumeCacheData>).tailoredResumes || {}
          : {},
      coverLetterText:
        typeof (raw as Partial<ResumeCacheData>).coverLetterText === "string"
          ? (raw as Partial<ResumeCacheData>).coverLetterText || ""
          : "",
      coverLetterUpdatedAt:
        typeof (raw as Partial<ResumeCacheData>).coverLetterUpdatedAt === "string"
          ? (raw as Partial<ResumeCacheData>).coverLetterUpdatedAt || ""
          : "",
      tailoredCoverLetters:
        (raw as Partial<ResumeCacheData>).tailoredCoverLetters &&
        typeof (raw as Partial<ResumeCacheData>).tailoredCoverLetters === "object"
          ? (raw as Partial<ResumeCacheData>).tailoredCoverLetters || {}
          : {},
    };
  } catch {
    return {
      resumeText: "",
      updatedAt: "",
      tailoredResumes: {},
      coverLetterText: "",
      coverLetterUpdatedAt: "",
      tailoredCoverLetters: {},
    };
  }
}

function writeResumeCache(next: ResumeCacheData) {
  fs.writeFileSync(getResumeCachePath(), JSON.stringify(next, null, 2), "utf8");
}

export function saveResumeCache(resumeText: string) {
  const current = readResumeCache();
  const now = new Date().toISOString();
  writeResumeCache({
    ...current,
    resumeText,
    updatedAt: now,
  });
}

export function loadResumeCache(): string | null {
  const cache = readResumeCache();
  return cache.resumeText || null;
}

export function getResumeCacheStatus() {
  const cache = readResumeCache();
  return {
    loaded: Boolean(cache.resumeText.trim()),
    characterCount: cache.resumeText.length,
    text: cache.resumeText,
    updatedAt: cache.updatedAt || null,
  };
}

export function saveTailoredResume(jobId: string, tailoredResume: string) {
  const cache = readResumeCache();
  const now = new Date().toISOString();
  writeResumeCache({
    ...cache,
    tailoredResumes: {
      ...cache.tailoredResumes,
      [jobId]: {
        text: tailoredResume,
        updatedAt: now,
      },
    },
  });
}

export function loadTailoredResume(jobId: string): string | null {
  const cache = readResumeCache();
  return cache.tailoredResumes[jobId]?.text || cache.tailoredResumes[`resume_${jobId}`]?.text || null;
}

export function saveCoverLetterCache(coverLetterText: string) {
  const current = readResumeCache();
  const now = new Date().toISOString();
  writeResumeCache({
    ...current,
    coverLetterText,
    coverLetterUpdatedAt: now,
  });
}

export function getCoverLetterCacheStatus() {
  const cache = readResumeCache();
  return {
    loaded: Boolean(cache.coverLetterText.trim()),
    characterCount: cache.coverLetterText.length,
    text: cache.coverLetterText,
    updatedAt: cache.coverLetterUpdatedAt || null,
  };
}

export function saveTailoredCoverLetter(jobId: string, letterText: string) {
  const cache = readResumeCache();
  const now = new Date().toISOString();
  writeResumeCache({
    ...cache,
    tailoredCoverLetters: {
      ...cache.tailoredCoverLetters,
      [jobId]: {
        text: letterText,
        updatedAt: now,
      },
    },
  });
}

export function loadTailoredCoverLetter(jobId: string): string | null {
  const cache = readResumeCache();
  return cache.tailoredCoverLetters[jobId]?.text || null;
}
