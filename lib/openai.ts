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

type WebSearchContextSize = "low" | "medium" | "high";
type ResponseVerbosity = "low" | "medium" | "high";

interface StructuredResponseOptions<T> {
  schemaName: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
  model?: string;
  description?: string;
  webSearch?: boolean;
  searchContextSize?: WebSearchContextSize;
  verbosity?: ResponseVerbosity;
  allowChatFallback?: boolean;
  fallbackModel?: string;
  fallbackExample?: T;
}

interface StructuredResponseResult<T> {
  data: T;
  outputText: string;
  webSources: string[];
}

interface ResumeCacheData {
  resumeText: string;
  updatedAt: string;
  tailoredResumes: Record<string, { text: string; updatedAt: string }>;
  coverLetterText: string;
  coverLetterUpdatedAt: string;
  tailoredCoverLetters: Record<string, { text: string; updatedAt: string }>;
}

const DEFAULT_FAST_MODEL = "gpt-5.4-nano";
const DEFAULT_DRAFT_MODEL = "gpt-5.4-mini";
const DEFAULT_CHAT_FALLBACK_MODEL = "gpt-4o";

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getConfiguredKey() {
  const config = getConfig();
  return config.apiKeys.openai;
}

export function getOpenAIClient() {
  const apiKey = getConfiguredKey();

  if (!apiKey) {
    throw new Error("OpenAI API key is missing in configuration.");
  }

  return new OpenAI({ apiKey });
}

function extractWebSources(response: unknown): string[] {
  const output = Array.isArray((response as { output?: unknown[] })?.output)
    ? ((response as { output?: unknown[] }).output as unknown[])
    : [];

  const urls = new Set<string>();

  output.forEach((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!record || record.type !== "web_search_call") return;

    const action = record.action && typeof record.action === "object"
      ? (record.action as Record<string, unknown>)
      : null;
    const sources = Array.isArray(action?.sources) ? (action?.sources as unknown[]) : [];

    sources.forEach((source) => {
      const sourceRecord = source && typeof source === "object" ? (source as Record<string, unknown>) : null;
      const url = typeof sourceRecord?.url === "string" ? sourceRecord.url : "";
      if (url) urls.add(url);
    });
  });

  return Array.from(urls);
}

export function getOpenAIModel(tier: "fast" | "draft" = "fast") {
  if (tier === "draft") {
    return process.env.OPENAI_DRAFT_MODEL || DEFAULT_DRAFT_MODEL;
  }
  return process.env.OPENAI_FAST_MODEL || DEFAULT_FAST_MODEL;
}

export async function runStructuredResponse<T>(
  options: StructuredResponseOptions<T>
): Promise<StructuredResponseResult<T>> {
  const client = getOpenAIClient();
  const model = options.model || getOpenAIModel(options.webSearch ? "draft" : "fast");
  const format = {
    type: "json_schema" as const,
    name: options.schemaName,
    schema: options.schema,
    strict: true,
    description: options.description,
  };

  try {
    const response = await client.responses.create({
      model,
      instructions: options.instructions,
      input: options.input,
      text: {
        format,
        verbosity: options.verbosity || "low",
      },
      include: options.webSearch ? ["web_search_call.action.sources"] : undefined,
      tools: options.webSearch
        ? [
            {
              type: "web_search_preview",
              search_context_size: options.searchContextSize || "medium",
              user_location: {
                type: "approximate",
                country: "DE",
                region: "Berlin",
                timezone: "Europe/Berlin",
              },
            },
          ]
        : undefined,
    });

    const outputText = typeof response.output_text === "string" ? response.output_text : "";
    const parsed = safeParseJson<T>(outputText);
    if (!parsed) {
      throw new Error(`Failed to parse structured response for ${options.schemaName}`);
    }

    return {
      data: parsed,
      outputText,
      webSources: extractWebSources(response),
    };
  } catch (error) {
    if (options.webSearch || options.allowChatFallback === false) {
      throw error;
    }

    const completion = await client.chat.completions.create({
      model: options.fallbackModel || DEFAULT_CHAT_FALLBACK_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${options.instructions}\nReturn JSON only.`,
        },
        {
          role: "user",
          content: `${options.input}\n\nJSON schema:\n${JSON.stringify(options.schema, null, 2)}`,
        },
      ],
    });

    const outputText = completion.choices[0]?.message?.content ?? "";
    const parsed = safeParseJson<T>(outputText);
    if (!parsed) {
      throw error;
    }

    return {
      data: parsed,
      outputText,
      webSources: [],
    };
  }
}

/** Send a prompt to GPT and get the text response. */
export async function askGPT(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<string> {
  const client = getOpenAIClient();

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
  if (process.env.VERCEL === "1") {
    return path.join("/tmp", ".resume-cache.json");
  }
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
