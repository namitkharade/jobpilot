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

export interface StoredTexDocument {
  texSource: string;
  fileName: string;
  updatedAt: string;
}

interface LegacyTailoredDocument {
  text: string;
  updatedAt: string;
}

interface ResumeCacheData {
  resumeText: string;
  updatedAt: string;
  tailoredResumes: Record<string, LegacyTailoredDocument>;
  coverLetterText: string;
  coverLetterUpdatedAt: string;
  tailoredCoverLetters: Record<string, LegacyTailoredDocument>;
  baseResumeDocument: StoredTexDocument | null;
  baseCoverLetterDocument: StoredTexDocument | null;
  tailoredResumeDocuments: Record<string, StoredTexDocument>;
  tailoredCoverLetterDocuments: Record<string, StoredTexDocument>;
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

export function looksLikeTex(source: string): boolean {
  const text = source.trim();
  if (!text) return false;

  return /\\documentclass|\\begin\{|\\section\*?\{|\\subsection\*?\{|\\item\b|\\textbf\{|\\resume/i.test(text);
}

export function extractPlainTextFromDocument(source: string): string {
  const text = source.trim();
  if (!text) return "";
  return looksLikeTex(text) ? extractResumeText(text) : text;
}

/** Resume caching logic */
export function getResumeCachePath() {
  if (process.env.VERCEL === "1") {
    return path.join("/tmp", ".resume-cache.json");
  }
  return path.join(process.cwd(), ".resume-cache.json");
}

function createEmptyResumeCache(): ResumeCacheData {
  return {
    resumeText: "",
    updatedAt: "",
    tailoredResumes: {},
    coverLetterText: "",
    coverLetterUpdatedAt: "",
    tailoredCoverLetters: {},
    baseResumeDocument: null,
    baseCoverLetterDocument: null,
    tailoredResumeDocuments: {},
    tailoredCoverLetterDocuments: {},
  };
}

function normalizeLegacyDocument(value: unknown): LegacyTailoredDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const text = typeof (value as { text?: unknown }).text === "string" ? (value as { text: string }).text : "";
  const updatedAt =
    typeof (value as { updatedAt?: unknown }).updatedAt === "string"
      ? (value as { updatedAt: string }).updatedAt
      : "";

  if (!text.trim() && !updatedAt) {
    return null;
  }

  return { text, updatedAt };
}

function normalizeStoredDocument(value: unknown): StoredTexDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const texSource =
    typeof (value as { texSource?: unknown }).texSource === "string"
      ? (value as { texSource: string }).texSource
      : "";
  const fileName =
    typeof (value as { fileName?: unknown }).fileName === "string"
      ? (value as { fileName: string }).fileName
      : "";
  const updatedAt =
    typeof (value as { updatedAt?: unknown }).updatedAt === "string"
      ? (value as { updatedAt: string }).updatedAt
      : "";

  if (!texSource.trim() && !fileName && !updatedAt) {
    return null;
  }

  return { texSource, fileName, updatedAt };
}

function normalizeLegacyDocumentMap(value: unknown): Record<string, LegacyTailoredDocument> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, LegacyTailoredDocument>>(
    (acc, [key, entry]) => {
      const normalized = normalizeLegacyDocument(entry);
      if (normalized) {
        acc[key] = normalized;
      }
      return acc;
    },
    {}
  );
}

function normalizeStoredDocumentMap(value: unknown): Record<string, StoredTexDocument> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, StoredTexDocument>>(
    (acc, [key, entry]) => {
      const normalized = normalizeStoredDocument(entry);
      if (normalized) {
        acc[key] = normalized;
      }
      return acc;
    },
    {}
  );
}

function buildStoredDocument(texSource: string, fileName: string | undefined, updatedAt: string): StoredTexDocument {
  return {
    texSource,
    fileName: fileName?.trim() || "",
    updatedAt,
  };
}

function getLegacyTailoredLookupKey(jobId: string): string[] {
  return [jobId, `resume_${jobId}`];
}

function readResumeCache(): ResumeCacheData {
  const p = getResumeCachePath();
  if (!fs.existsSync(p)) {
    return createEmptyResumeCache();
  }

  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as
      | Partial<ResumeCacheData>
      | { resumeText?: string };

    return {
      resumeText: typeof raw.resumeText === "string" ? raw.resumeText : "",
      updatedAt:
        typeof (raw as Partial<ResumeCacheData>).updatedAt === "string"
          ? (raw as Partial<ResumeCacheData>).updatedAt || ""
          : "",
      tailoredResumes: normalizeLegacyDocumentMap((raw as Partial<ResumeCacheData>).tailoredResumes),
      coverLetterText:
        typeof (raw as Partial<ResumeCacheData>).coverLetterText === "string"
          ? (raw as Partial<ResumeCacheData>).coverLetterText || ""
          : "",
      coverLetterUpdatedAt:
        typeof (raw as Partial<ResumeCacheData>).coverLetterUpdatedAt === "string"
          ? (raw as Partial<ResumeCacheData>).coverLetterUpdatedAt || ""
          : "",
      tailoredCoverLetters: normalizeLegacyDocumentMap((raw as Partial<ResumeCacheData>).tailoredCoverLetters),
      baseResumeDocument: normalizeStoredDocument((raw as Partial<ResumeCacheData>).baseResumeDocument),
      baseCoverLetterDocument: normalizeStoredDocument((raw as Partial<ResumeCacheData>).baseCoverLetterDocument),
      tailoredResumeDocuments: normalizeStoredDocumentMap((raw as Partial<ResumeCacheData>).tailoredResumeDocuments),
      tailoredCoverLetterDocuments: normalizeStoredDocumentMap(
        (raw as Partial<ResumeCacheData>).tailoredCoverLetterDocuments
      ),
    };
  } catch {
    return createEmptyResumeCache();
  }
}

function writeResumeCache(next: ResumeCacheData) {
  fs.writeFileSync(getResumeCachePath(), JSON.stringify(next, null, 2), "utf8");
}

function getResumeDocumentFromCache(cache: ResumeCacheData, jobId?: string): StoredTexDocument | null {
  if (jobId?.trim()) {
    const direct = cache.tailoredResumeDocuments[jobId];
    if (direct) return direct;

    const legacy = getLegacyTailoredLookupKey(jobId)
      .map((key) => cache.tailoredResumes[key])
      .find((entry) => entry?.text?.trim());

    return legacy
      ? buildStoredDocument(legacy.text, `${jobId}.tex`, legacy.updatedAt || "")
      : null;
  }

  if (cache.baseResumeDocument?.texSource.trim()) {
    return cache.baseResumeDocument;
  }

  if (cache.resumeText.trim()) {
    return buildStoredDocument(cache.resumeText, "resume.tex", cache.updatedAt || "");
  }

  return null;
}

function getCoverLetterDocumentFromCache(cache: ResumeCacheData, jobId?: string): StoredTexDocument | null {
  if (jobId?.trim()) {
    const direct = cache.tailoredCoverLetterDocuments[jobId];
    if (direct) return direct;

    const legacy = cache.tailoredCoverLetters[jobId];
    return legacy
      ? buildStoredDocument(legacy.text, `${jobId}-cover-letter.txt`, legacy.updatedAt || "")
      : null;
  }

  if (cache.baseCoverLetterDocument?.texSource.trim()) {
    return cache.baseCoverLetterDocument;
  }

  if (cache.coverLetterText.trim()) {
    return buildStoredDocument(cache.coverLetterText, "cover-letter.txt", cache.coverLetterUpdatedAt || "");
  }

  return null;
}

function buildDocumentStatus(document: StoredTexDocument | null) {
  return {
    loaded: Boolean(document?.texSource.trim()),
    characterCount: document?.texSource.length || 0,
    text: document?.texSource || "",
    texSource: document?.texSource || "",
    fileName: document?.fileName || null,
    updatedAt: document?.updatedAt || null,
  };
}

export function saveResumeCache(resumeText: string, options?: { fileName?: string }) {
  const current = readResumeCache();
  const now = new Date().toISOString();
  const document = buildStoredDocument(resumeText, options?.fileName || "resume.tex", now);
  writeResumeCache({
    ...current,
    resumeText,
    updatedAt: now,
    baseResumeDocument: document,
  });
}

export function loadResumeCache(): string | null {
  return getResumeDocument()?.texSource || null;
}

export function getResumeCacheStatus() {
  return buildDocumentStatus(getResumeDocument());
}

export function getResumeDocument(jobId?: string): StoredTexDocument | null {
  return getResumeDocumentFromCache(readResumeCache(), jobId);
}

export function getResumeTextForPrompt(jobId?: string): string {
  return extractPlainTextFromDocument(getResumeDocument(jobId)?.texSource || "");
}

export function saveTailoredResume(jobId: string, tailoredResume: string, options?: { fileName?: string }) {
  const cache = readResumeCache();
  const now = new Date().toISOString();
  const document = buildStoredDocument(tailoredResume, options?.fileName || `${jobId}.tex`, now);
  writeResumeCache({
    ...cache,
    tailoredResumes: {
      ...cache.tailoredResumes,
      [jobId]: {
        text: tailoredResume,
        updatedAt: now,
      },
    },
    tailoredResumeDocuments: {
      ...cache.tailoredResumeDocuments,
      [jobId]: document,
    },
  });
}

export function loadTailoredResume(jobId: string): string | null {
  return getResumeDocument(jobId)?.texSource || null;
}

export function getResumeDocumentStatus(jobId?: string) {
  return buildDocumentStatus(getResumeDocument(jobId));
}

export function clearResumeCache() {
  const cache = readResumeCache();
  writeResumeCache({
    ...cache,
    resumeText: "",
    updatedAt: "",
    baseResumeDocument: null,
  });
}

export function saveCoverLetterCache(coverLetterText: string, options?: { fileName?: string }) {
  const current = readResumeCache();
  const now = new Date().toISOString();
  const document = buildStoredDocument(
    coverLetterText,
    options?.fileName || "cover-letter.tex",
    now
  );
  writeResumeCache({
    ...current,
    coverLetterText,
    coverLetterUpdatedAt: now,
    baseCoverLetterDocument: document,
  });
}

export function getCoverLetterCacheStatus() {
  return buildDocumentStatus(getCoverLetterDocument());
}

export function getCoverLetterDocument(jobId?: string): StoredTexDocument | null {
  return getCoverLetterDocumentFromCache(readResumeCache(), jobId);
}

export function getCoverLetterTextForPrompt(jobId?: string): string {
  return extractPlainTextFromDocument(getCoverLetterDocument(jobId)?.texSource || "");
}

export function saveTailoredCoverLetter(jobId: string, letterText: string, options?: { fileName?: string }) {
  const cache = readResumeCache();
  const now = new Date().toISOString();
  const document = buildStoredDocument(
    letterText,
    options?.fileName || `${jobId}-cover-letter.tex`,
    now
  );
  writeResumeCache({
    ...cache,
    tailoredCoverLetters: {
      ...cache.tailoredCoverLetters,
      [jobId]: {
        text: letterText,
        updatedAt: now,
      },
    },
    tailoredCoverLetterDocuments: {
      ...cache.tailoredCoverLetterDocuments,
      [jobId]: document,
    },
  });
}

export function loadTailoredCoverLetter(jobId: string): string | null {
  return getCoverLetterDocument(jobId)?.texSource || null;
}

export function getCoverLetterDocumentStatus(jobId?: string) {
  return buildDocumentStatus(getCoverLetterDocument(jobId));
}
