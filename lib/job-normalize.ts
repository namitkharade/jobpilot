import {
  CandidateChannel,
  CompanyIntel,
  EmailVerificationStatus,
  JobListing,
  JobStatus,
  OutreachBrief,
  OutreachChannel,
  OutreachDraft,
  OutreachState,
  OutreachStatus,
  RecruiterCandidate,
  RecruiterCandidateRole,
  ResearchEvidence,
  ResearchSourceType,
} from "@/types";

const VALID_STATUSES: JobStatus[] = ["saved", "applied", "interviewing", "rejected", "ghosted"];
const VALID_SOURCE_TYPES: ResearchSourceType[] = [
  "legacy",
  "job-poster",
  "apply-url",
  "hunter",
  "openai-web",
  "searxng",
  "manual",
];
const VALID_ROLES: RecruiterCandidateRole[] = [
  "recruiter",
  "hiring-manager",
  "department-head",
  "job-poster",
  "legacy",
  "unknown",
];
const VALID_CHANNELS: CandidateChannel[] = ["email", "linkedin"];
const VALID_EMAIL_STATUSES: EmailVerificationStatus[] = [
  "valid",
  "accept_all",
  "unknown",
  "unverified",
  "not_found",
];
const VALID_OUTREACH_CHANNELS: OutreachChannel[] = ["email", "linkedin", "blocked"];
const VALID_OUTREACH_STATUSES: OutreachStatus[] = ["idle", "researched", "drafted", "sent", "blocked"];

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim().startsWith("{")) {
    const parsed = safeJsonParse<Record<string, unknown>>(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  }
  return null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }
  if (typeof value === "string" && value.trim().startsWith("[")) {
    const parsed = safeJsonParse<unknown[]>(value);
    return Array.isArray(parsed)
      ? parsed.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry))
      : [];
  }
  return [];
}

function asValidString<T extends string>(value: unknown, valid: readonly T[], fallback: T): T {
  return valid.includes(value as T) ? (value as T) : fallback;
}

function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export function extractLinkedInHandle(linkedinUrl: string): string {
  const normalized = normalizeUrl(linkedinUrl);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    const parts = url.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) return "";
    if (parts[0] !== "in" && parts[0] !== "pub") return "";
    return parts[1].replace(/[^a-zA-Z0-9-_%]/g, "");
  } catch {
    return "";
  }
}

export function inferCandidateRoleFromTitle(title: string): RecruiterCandidateRole {
  const normalized = title.toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("recruiter") || normalized.includes("talent") || normalized.includes("sourcer")) {
    return "recruiter";
  }
  if (
    normalized.includes("head") ||
    normalized.includes("vp") ||
    normalized.includes("chief") ||
    normalized.includes("vice president")
  ) {
    return "department-head";
  }
  if (normalized.includes("manager") || normalized.includes("director") || normalized.includes("lead")) {
    return "hiring-manager";
  }
  return "unknown";
}

function deriveChannelOptions(email: string, linkedinUrl: string): CandidateChannel[] {
  const options: CandidateChannel[] = [];
  if (email.trim()) options.push("email");
  if (linkedinUrl.trim()) options.push("linkedin");
  return options;
}

export function buildCandidateId(seed: { name?: string; title?: string; linkedinUrl?: string; email?: string }): string {
  const parts = [seed.linkedinUrl, seed.email, seed.name, seed.title]
    .map((part) => asString(part).trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) {
    return `candidate_${Math.random().toString(36).slice(2, 10)}`;
  }
  return `candidate_${parts.join("|").replace(/[^a-z0-9|]+/g, "_").slice(0, 96)}`;
}

export function normalizeResearchEvidence(input: unknown): ResearchEvidence {
  const record = asRecord(input) ?? {};
  const sourceType = asValidString(record.sourceType, VALID_SOURCE_TYPES, "manual");
  return {
    sourceType,
    url: normalizeUrl(asString(record.url || record.uri)),
    title: asString(record.title),
    snippet: asString(record.snippet || record.content),
    domain: normalizeDomain(asString(record.domain)),
    extractedOn: asString(record.extractedOn || record.extracted_on),
    lastSeenOn: asString(record.lastSeenOn || record.last_seen_on),
    stillOnPage: asBoolean(record.stillOnPage ?? record.still_on_page),
  };
}

export function normalizeCompanyIntel(input: unknown): CompanyIntel | null {
  const record = asRecord(input);
  if (!record) return null;

  return {
    domain: normalizeDomain(asString(record.domain)),
    description: asString(record.description),
    industry: asString(record.industry),
    size: asString(record.size),
    location: asString(record.location),
    signals: asRecordArray(record.signals).map(normalizeResearchEvidence),
    updatedAt: asString(record.updatedAt),
  };
}

export function normalizeRecruiterCandidate(input: unknown): RecruiterCandidate {
  const record = asRecord(input) ?? {};
  const email = asString(record.email).trim();
  const linkedinUrl = normalizeUrl(asString(record.linkedinUrl || record.linkedin));
  const channelOptionsRaw = Array.isArray(record.channelOptions)
    ? (record.channelOptions as unknown[]).filter((entry): entry is CandidateChannel => VALID_CHANNELS.includes(entry as CandidateChannel))
    : [];
  const role = asValidString(record.role, VALID_ROLES, inferCandidateRoleFromTitle(asString(record.title)));
  const emailVerificationStatus = asValidString(
    record.emailVerificationStatus || record.emailStatus,
    VALID_EMAIL_STATUSES,
    email ? "unverified" : "not_found"
  );

  return {
    id: asString(record.id) || buildCandidateId({
      name: asString(record.name),
      title: asString(record.title),
      linkedinUrl,
      email,
    }),
    name: asString(record.name),
    title: asString(record.title),
    role,
    linkedinUrl,
    linkedinHandle: asString(record.linkedinHandle) || extractLinkedInHandle(linkedinUrl),
    email,
    emailVerificationStatus,
    emailConfidence: asNumber(record.emailConfidence ?? record.confidence),
    domainPattern: asString(record.domainPattern),
    channelOptions: channelOptionsRaw.length ? channelOptionsRaw : deriveChannelOptions(email, linkedinUrl),
    score: asNumber(record.score ?? record.confidence),
    reasons: asStringArray(record.reasons),
    sourceTypes: Array.isArray(record.sourceTypes)
      ? (record.sourceTypes as unknown[]).filter((entry): entry is ResearchSourceType => VALID_SOURCE_TYPES.includes(entry as ResearchSourceType))
      : [],
    sourceSummary: asString(record.sourceSummary || record.source),
    evidence: asRecordArray(record.evidence).map(normalizeResearchEvidence),
  };
}

function normalizeOutreachDraft(input: unknown): OutreachDraft {
  const record = asRecord(input) ?? {};
  return {
    id: asString(record.id) || `draft_${Math.random().toString(36).slice(2, 10)}`,
    candidateId: asString(record.candidateId),
    channel: asValidString(record.channel, VALID_CHANNELS, "email"),
    tone: asValidString(record.tone, ["professional", "conversational", "direct"] as const, "professional"),
    subject: asString(record.subject),
    body: asString(record.body),
    wordCount: asNumber(record.wordCount, asString(record.body).split(/\s+/).filter(Boolean).length),
    hookType: asString(record.hookType),
    cta: asString(record.cta),
    groundingUrls: asStringArray(record.groundingUrls),
    generatedAt: asString(record.generatedAt),
    sentAt: asString(record.sentAt) || null,
  };
}

function normalizeOutreachBrief(input: unknown): OutreachBrief | null {
  const record = asRecord(input);
  if (!record) return null;
  return {
    key: asString(record.key),
    candidateId: asString(record.candidateId),
    channel: asValidString(record.channel, VALID_OUTREACH_CHANNELS, "blocked"),
    summary: asString(record.summary),
    highlights: asStringArray(record.highlights),
    requirements: asStringArray(record.requirements),
    groundingUrls: asStringArray(record.groundingUrls),
    updatedAt: asString(record.updatedAt),
  };
}

export function createEmptyOutreachState(): OutreachState {
  return {
    status: "idle",
    preferredChannel: "blocked",
    selectedDraftId: "",
    drafts: [],
    brief: null,
    lastResearchedAt: "",
    lastDraftedAt: "",
    lastSentAt: "",
  };
}

export function normalizeOutreachState(input: unknown): OutreachState {
  const record = asRecord(input);
  if (!record) return createEmptyOutreachState();

  const drafts = asRecordArray(record.drafts).map(normalizeOutreachDraft);
  const selectedDraftId = asString(record.selectedDraftId);
  return {
    status: asValidString(record.status, VALID_OUTREACH_STATUSES, drafts.length ? "drafted" : "idle"),
    preferredChannel: asValidString(record.preferredChannel, VALID_OUTREACH_CHANNELS, drafts.length ? drafts[0].channel : "blocked"),
    selectedDraftId: selectedDraftId || drafts[0]?.id || "",
    drafts,
    brief: normalizeOutreachBrief(record.brief),
    lastResearchedAt: asString(record.lastResearchedAt),
    lastDraftedAt: asString(record.lastDraftedAt),
    lastSentAt: asString(record.lastSentAt),
  };
}

export function getSelectedRecruiterCandidate(job: Pick<JobListing, "recruiterCandidates" | "selectedRecruiterId">): RecruiterCandidate | null {
  if (!job.recruiterCandidates.length) return null;
  return job.recruiterCandidates.find((candidate) => candidate.id === job.selectedRecruiterId) || job.recruiterCandidates[0];
}

function getSelectedDraft(job: Pick<JobListing, "outreach">): OutreachDraft | null {
  if (!job.outreach.drafts.length) return null;
  return job.outreach.drafts.find((draft) => draft.id === job.outreach.selectedDraftId) || job.outreach.drafts[0];
}

export function projectLegacyRecruiterFields(
  job: Pick<JobListing, "recruiterCandidates" | "selectedRecruiterId" | "outreach">
): Pick<JobListing, "recruiterName" | "recruiterTitle" | "recruiterProfileUrl" | "recruiterEmail" | "emailDraft"> {
  const selectedCandidate = getSelectedRecruiterCandidate(job);
  const selectedDraft = getSelectedDraft(job);

  return {
    recruiterName: selectedCandidate?.name || "",
    recruiterTitle: selectedCandidate?.title || "",
    recruiterProfileUrl: selectedCandidate?.linkedinUrl || "",
    recruiterEmail: selectedCandidate?.email || "",
    emailDraft: selectedDraft?.channel === "email" ? selectedDraft.body : "",
  };
}

export function repairJobDescriptionMapping(job: JobListing): JobListing {
  const brokenDescriptionInProfileUrl =
    !job.jobDescription.trim() &&
    job.recruiterProfileUrl.trim().length > 100 &&
    !isLikelyUrl(job.recruiterProfileUrl);

  if (!brokenDescriptionInProfileUrl) {
    return job;
  }

  return {
    ...job,
    jobDescription: job.recruiterProfileUrl,
    recruiterProfileUrl: "",
  };
}

function buildLegacyCandidate(input: Partial<JobListing>): RecruiterCandidate | null {
  const name = asString(input.recruiterName);
  const title = asString(input.recruiterTitle);
  const linkedinUrl = normalizeUrl(asString(input.recruiterProfileUrl));
  const email = asString(input.recruiterEmail);

  if (!name && !title && !linkedinUrl && !email) {
    return null;
  }

  return normalizeRecruiterCandidate({
    id: buildCandidateId({ name, title, linkedinUrl, email }),
    name,
    title,
    role: title ? inferCandidateRoleFromTitle(title) : "legacy",
    linkedinUrl,
    email,
    emailVerificationStatus: email ? "unverified" : "not_found",
    emailConfidence: email ? 60 : 0,
    domainPattern: "",
    channelOptions: deriveChannelOptions(email, linkedinUrl),
    score: email ? 70 : linkedinUrl ? 55 : 40,
    reasons: ["Migrated from legacy recruiter fields"],
    sourceTypes: ["legacy"],
    sourceSummary: "Migrated from legacy recruiter fields",
    evidence: [],
  });
}

export function normalizeJobListing(input: Partial<JobListing> | Record<string, unknown>): JobListing {
  const raw = input as Partial<JobListing> & Record<string, unknown>;
  const companyIntel = normalizeCompanyIntel(raw.companyIntel);
  const recruiterCandidates = (
    Array.isArray(raw.recruiterCandidates)
      ? raw.recruiterCandidates
      : asRecordArray(raw.recruiterCandidates)
  ).map(normalizeRecruiterCandidate);
  const legacyCandidate = recruiterCandidates.length ? null : buildLegacyCandidate(raw);
  const allCandidates = legacyCandidate ? [legacyCandidate] : recruiterCandidates;

  const outreach = normalizeOutreachState(raw.outreach);
  const selectedRecruiterId =
    asString(raw.selectedRecruiterId) ||
    allCandidates[0]?.id ||
    "";

  const base: JobListing = {
    id: asString(raw.id),
    title: asString(raw.title),
    company: asString(raw.company),
    location: asString(raw.location),
    salary: asString(raw.salary),
    jobType: asString(raw.jobType),
    postedAt: asString(raw.postedAt),
    scrapedAt: asString(raw.scrapedAt),
    applyUrl: normalizeUrl(asString(raw.applyUrl)),
    jobDescription: asString(raw.jobDescription),
    companyDescription: asString(raw.companyDescription),
    atsScore: typeof raw.atsScore === "number" ? raw.atsScore : null,
    atsKeywordGaps: asStringArray(raw.atsKeywordGaps),
    atsSuggestions: Array.isArray(raw.atsSuggestions) ? raw.atsSuggestions : [],
    status: VALID_STATUSES.includes(raw.status as JobStatus) ? (raw.status as JobStatus) : "saved",
    companyDomain: normalizeDomain(asString(raw.companyDomain || companyIntel?.domain)),
    companyIntel,
    recruiterCandidates: allCandidates,
    selectedRecruiterId,
    outreach,
    recruiterName: asString(raw.recruiterName),
    recruiterTitle: asString(raw.recruiterTitle),
    recruiterProfileUrl: normalizeUrl(asString(raw.recruiterProfileUrl)),
    recruiterEmail: asString(raw.recruiterEmail),
    emailDraft: asString(raw.emailDraft),
    source: raw.source === "indeed" ? "indeed" : "linkedin",
    jobPosterName: asString(raw.jobPosterName),
    jobPosterTitle: asString(raw.jobPosterTitle),
  };

  const projectedLegacy = projectLegacyRecruiterFields(base);
  const normalized = {
    ...base,
    ...projectedLegacy,
    selectedRecruiterId: getSelectedRecruiterCandidate(base)?.id || "",
    companyDomain: base.companyDomain || companyIntel?.domain || "",
  };

  return repairJobDescriptionMapping(normalized);
}
