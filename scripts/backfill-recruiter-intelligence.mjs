import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import { google } from "googleapis";

const cwd = process.cwd();
const jobsDbPath = process.env.VERCEL === "1" ? "/tmp/jobs-db.json" : path.join(cwd, "jobs-db.json");
const configPath = process.env.VERCEL === "1" ? "/tmp/config.json" : path.join(cwd, "config.json");

const CANONICAL_HEADERS = [
  "id",
  "title",
  "company",
  "location",
  "salary",
  "jobType",
  "source",
  "postedAt",
  "scrapedAt",
  "applyUrl",
  "status",
  "atsScore",
  "recruiterName",
  "recruiterEmail",
  "recruiterProfileUrl",
  "jobDescription",
  "atsKeywordGaps",
  "atsSuggestions",
  "companyDescription",
  "recruiterTitle",
  "emailDraft",
  "jobPosterName",
  "jobPosterTitle",
  "companyDomain",
  "companyIntel",
  "recruiterCandidates",
  "selectedRecruiterId",
  "outreach",
];

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeUrl(url = "") {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function normalizeDomain(domain = "") {
  return String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function extractLinkedInHandle(linkedinUrl = "") {
  try {
    const url = new URL(normalizeUrl(linkedinUrl));
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "in" && parts[0] !== "pub") return "";
    return (parts[1] || "").replace(/[^a-zA-Z0-9-_%]/g, "");
  } catch {
    return "";
  }
}

function inferRole(title = "") {
  const normalized = String(title || "").toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("recruiter") || normalized.includes("talent") || normalized.includes("sourcer")) return "recruiter";
  if (normalized.includes("head") || normalized.includes("vp") || normalized.includes("chief")) return "department-head";
  if (normalized.includes("manager") || normalized.includes("director") || normalized.includes("lead")) return "hiring-manager";
  return "unknown";
}

function buildCandidateId(seed) {
  const joined = [seed.linkedinUrl, seed.email, seed.name, seed.title]
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
  return `candidate_${createHash("sha256").update(joined || Math.random().toString()).digest("hex").slice(0, 16)}`;
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeEvidence(entry) {
  return {
    sourceType: entry?.sourceType || "manual",
    url: normalizeUrl(entry?.url || entry?.uri || ""),
    title: String(entry?.title || ""),
    snippet: String(entry?.snippet || entry?.content || ""),
    domain: normalizeDomain(entry?.domain || ""),
    extractedOn: String(entry?.extractedOn || entry?.extracted_on || ""),
    lastSeenOn: String(entry?.lastSeenOn || entry?.last_seen_on || ""),
    stillOnPage: Boolean(entry?.stillOnPage || entry?.still_on_page),
  };
}

function normalizeCandidate(entry = {}) {
  const linkedinUrl = normalizeUrl(entry.linkedinUrl || entry.linkedin || "");
  const email = String(entry.email || "");
  const candidate = {
    id: String(entry.id || buildCandidateId(entry)),
    name: String(entry.name || ""),
    title: String(entry.title || ""),
    role: entry.role || inferRole(entry.title || ""),
    linkedinUrl,
    linkedinHandle: String(entry.linkedinHandle || extractLinkedInHandle(linkedinUrl)),
    email,
    emailVerificationStatus: entry.emailVerificationStatus || (email ? "unverified" : "not_found"),
    emailConfidence: Number(entry.emailConfidence ?? entry.confidence ?? 0) || 0,
    domainPattern: String(entry.domainPattern || ""),
    channelOptions: Array.isArray(entry.channelOptions)
      ? entry.channelOptions
      : [email ? "email" : null, linkedinUrl ? "linkedin" : null].filter(Boolean),
    score: Number(entry.score ?? entry.confidence ?? 0) || 0,
    reasons: Array.isArray(entry.reasons) ? entry.reasons.filter(Boolean) : [],
    sourceTypes: Array.isArray(entry.sourceTypes) ? entry.sourceTypes.filter(Boolean) : [],
    sourceSummary: String(entry.sourceSummary || entry.source || ""),
    evidence: Array.isArray(entry.evidence) ? entry.evidence.map(normalizeEvidence) : [],
  };
  return candidate;
}

function createLegacyCandidate(job) {
  if (!job.recruiterName && !job.recruiterTitle && !job.recruiterProfileUrl && !job.recruiterEmail) return null;
  return normalizeCandidate({
    name: job.recruiterName || "",
    title: job.recruiterTitle || "",
    linkedinUrl: job.recruiterProfileUrl || "",
    email: job.recruiterEmail || "",
    emailVerificationStatus: job.recruiterEmail ? "unverified" : "not_found",
    emailConfidence: job.recruiterEmail ? 60 : 0,
    domainPattern: "",
    score: job.recruiterEmail ? 70 : job.recruiterProfileUrl ? 55 : 40,
    reasons: ["Migrated from legacy recruiter fields"],
    sourceTypes: ["legacy"],
    sourceSummary: "Migrated from legacy recruiter fields",
    evidence: [],
  });
}

function normalizeOutreach(outreach = {}) {
  const parsed = parseMaybeJson(outreach, {});
  const drafts = Array.isArray(parsed.drafts)
    ? parsed.drafts.map((draft) => ({
        id: String(draft.id || `draft_${Math.random().toString(36).slice(2, 10)}`),
        candidateId: String(draft.candidateId || ""),
        channel: draft.channel || "email",
        tone: draft.tone || "professional",
        subject: String(draft.subject || ""),
        body: String(draft.body || ""),
        wordCount: Number(draft.wordCount || String(draft.body || "").split(/\s+/).filter(Boolean).length),
        hookType: String(draft.hookType || ""),
        cta: String(draft.cta || draft.callToAction || ""),
        groundingUrls: Array.isArray(draft.groundingUrls) ? draft.groundingUrls.filter(Boolean) : [],
        generatedAt: String(draft.generatedAt || ""),
        sentAt: draft.sentAt || null,
      }))
    : [];

  return {
    status: parsed.status || (drafts.length ? "drafted" : "idle"),
    preferredChannel: parsed.preferredChannel || (drafts[0]?.channel || "blocked"),
    selectedDraftId: parsed.selectedDraftId || drafts[0]?.id || "",
    drafts,
    brief: parsed.brief || null,
    lastResearchedAt: parsed.lastResearchedAt || "",
    lastDraftedAt: parsed.lastDraftedAt || "",
    lastSentAt: parsed.lastSentAt || "",
  };
}

function backfillJob(rawJob) {
  const companyIntel = parseMaybeJson(rawJob.companyIntel, null);
  const recruiterCandidatesRaw = parseMaybeJson(rawJob.recruiterCandidates, []);
  const recruiterCandidates = Array.isArray(recruiterCandidatesRaw)
    ? recruiterCandidatesRaw.map(normalizeCandidate)
    : [];
  const legacyCandidate = recruiterCandidates.length ? null : createLegacyCandidate(rawJob);
  const allCandidates = legacyCandidate ? [legacyCandidate] : recruiterCandidates;
  const outreach = normalizeOutreach(rawJob.outreach || {});
  const selectedCandidate =
    allCandidates.find((candidate) => candidate.id === rawJob.selectedRecruiterId) || allCandidates[0] || null;
  const selectedDraft =
    outreach.drafts.find((draft) => draft.id === outreach.selectedDraftId) || outreach.drafts[0] || null;

  return {
    ...rawJob,
    companyDomain: normalizeDomain(rawJob.companyDomain || companyIntel?.domain || ""),
    companyIntel: companyIntel || null,
    recruiterCandidates: allCandidates,
    selectedRecruiterId: selectedCandidate?.id || "",
    outreach,
    recruiterName: selectedCandidate?.name || rawJob.recruiterName || "",
    recruiterTitle: selectedCandidate?.title || rawJob.recruiterTitle || "",
    recruiterProfileUrl: selectedCandidate?.linkedinUrl || normalizeUrl(rawJob.recruiterProfileUrl || ""),
    recruiterEmail: selectedCandidate?.email || rawJob.recruiterEmail || "",
    emailDraft: selectedDraft?.channel === "email" ? selectedDraft.body : rawJob.emailDraft || "",
  };
}

async function backfillLocalDb() {
  const db = readJson(jobsDbPath, { jobs: [] });
  if (!Array.isArray(db.jobs)) return 0;
  const jobs = db.jobs.map(backfillJob);
  writeJson(jobsDbPath, { jobs });
  return jobs.length;
}

function getConfig() {
  return readJson(configPath, { apiKeys: {} });
}

function getGoogleConfig() {
  const config = getConfig();
  return {
    serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || config.apiKeys?.googleServiceAccount || "",
    sheetsId: process.env.GOOGLE_SHEETS_ID || config.apiKeys?.googleSheetsId || "",
  };
}

function toColumnName(index) {
  let n = index;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

async function backfillSheets() {
  const { serviceAccount, sheetsId } = getGoogleConfig();
  if (!serviceAccount || !sheetsId) return 0;

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(serviceAccount),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsId,
    range: "A:ZZ",
  });

  const rows = Array.isArray(response.data.values) ? response.data.values : [];
  const currentHeaders = rows[0] || [];
  const headers = [...currentHeaders];
  CANONICAL_HEADERS.forEach((header) => {
    if (!headers.includes(header)) headers.push(header);
  });

  if (headers.length !== currentHeaders.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range: `A1:${toColumnName(headers.length)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  const headerMap = Object.fromEntries(headers.map((header, index) => [header, index]));
  let updatedRows = 0;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const record = Object.fromEntries(headers.map((header) => [header, row[headerMap[header]] || ""]));
    const nextJob = backfillJob(record);
    const values = headers.map((header) => {
      const value = nextJob[header];
      if (header === "companyIntel" || header === "outreach") return value ? JSON.stringify(value) : "";
      if (header === "recruiterCandidates") return JSON.stringify(value || []);
      if (header === "atsSuggestions") return JSON.stringify(value || []);
      if (header === "atsKeywordGaps") return Array.isArray(value) ? value.join(",") : "";
      return value ?? "";
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range: `A${rowIndex + 1}:${toColumnName(headers.length)}${rowIndex + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: [values] },
    });
    updatedRows += 1;
  }

  return updatedRows;
}

async function main() {
  const localCount = await backfillLocalDb();
  const sheetCount = await backfillSheets();
  console.log(`Backfilled recruiter intelligence for ${localCount} local jobs and ${sheetCount} sheet rows.`);
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exitCode = 1;
});
