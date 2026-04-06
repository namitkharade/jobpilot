import {
  EmailVerificationStatus,
  RecruiterCandidate,
  RecruiterCandidateRole,
  RecruiterProfile,
  ResearchEvidence,
} from "@/types";
import {
  extractLinkedInHandle,
  inferCandidateRoleFromTitle,
  normalizeRecruiterCandidate,
} from "./job-normalize";
import { getConfig } from "./local-store";

type HunterDepartment =
  | "hr"
  | "engineering"
  | "sales"
  | "marketing"
  | "it"
  | "finance"
  | "management"
  | "legal"
  | "communication"
  | "support";

type HunterContactType = "personal" | "generic";

interface HunterSearchOptions {
  domain: string;
  department?: HunterDepartment;
  type?: HunterContactType;
  jobTitles?: string[];
  seniority?: string[];
  verificationStatuses?: EmailVerificationStatus[];
  requiredFields?: string[];
  limit?: number;
  offset?: number;
  roleHint?: RecruiterCandidateRole;
}

interface HunterCompanySnapshot {
  company: string;
  domain: string;
  description: string;
  industry: string;
  size: string;
  location: string;
  pattern: string;
}

interface HunterSearchResult {
  candidates: RecruiterCandidate[];
  company: HunterCompanySnapshot | null;
}

export interface CandidateEmailResolution {
  candidate: RecruiterCandidate;
  method: "existing" | "hunter-direct" | "hunter-enrichment" | "pattern-verified" | "not-found";
}

const DEPT_MAP: Record<string, HunterDepartment> = {
  engineering: "engineering",
  data: "engineering",
  platform: "engineering",
  infrastructure: "engineering",
  backend: "engineering",
  frontend: "engineering",
  mobile: "engineering",
  ml: "engineering",
  ai: "engineering",
  devops: "engineering",
  security: "engineering",
  research: "engineering",
  science: "engineering",
  sales: "sales",
  revenue: "sales",
  "business development": "sales",
  bd: "sales",
  partnerships: "sales",
  account: "sales",
  marketing: "marketing",
  growth: "marketing",
  brand: "marketing",
  content: "marketing",
  seo: "marketing",
  demand: "marketing",
  hr: "hr",
  "human resources": "hr",
  people: "hr",
  talent: "hr",
  recruiting: "hr",
  "people ops": "hr",
  operations: "management",
  management: "management",
  "customer success": "support",
  support: "support",
  finance: "finance",
  legal: "legal",
  compliance: "legal",
  it: "it",
};

const BASE_URL = "https://api.hunter.io/v2";
const DEFAULT_LIMIT = 10;

const RECRUITER_TITLES = [
  "recruiter",
  "technical recruiter",
  "talent acquisition",
  "talent partner",
  "talent acquisition partner",
  "people partner",
  "hr business partner",
  "people operations",
];

const MANAGER_TITLES = [
  "hiring manager",
  "engineering manager",
  "director",
  "head of engineering",
  "head of product",
  "vp engineering",
  "vice president",
];

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function getHunterKey(): string {
  return process.env.HUNTER_API_KEY || getConfig().apiKeys.hunter || "";
}

export function hasHunterKey(): boolean {
  return Boolean(getHunterKey());
}

export function mapDepartmentToHunter(raw: string): HunterDepartment | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(DEPT_MAP)) {
    if (lower.includes(key)) return value;
  }
  return null;
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  query.set("api_key", getHunterKey());
  return query.toString();
}

async function hunterRequest(
  path: string,
  query: Record<string, string | number | undefined> = {},
  options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}
) {
  const apiKey = getHunterKey();
  if (!apiKey) {
    throw new Error("Hunter API key missing");
  }

  const method = options.method || "GET";
  const url = `${BASE_URL}${path}?${buildQueryString(query)}`;

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify({ ...options.body, api_key: apiKey }) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Hunter request failed (${response.status})`);
  }

  return response.json();
}

function normalizeVerificationStatus(status: string): EmailVerificationStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === "valid") return "valid";
  if (normalized === "accept_all" || normalized === "accept-all") return "accept_all";
  if (normalized === "unknown") return "unknown";
  if (normalized === "not_found" || normalized === "not-found") return "not_found";
  return "unverified";
}

function normalizeEvidenceDomain(urlOrDomain: string): string {
  const normalized = normalizeDomain(urlOrDomain);
  if (normalized) return normalized;

  try {
    return normalizeDomain(new URL(urlOrDomain).hostname);
  } catch {
    return "";
  }
}

function parseHunterSources(entry: Record<string, unknown>): ResearchEvidence[] {
  const sources = Array.isArray(entry.sources) ? (entry.sources as unknown[]) : [];
  return sources
    .map((source) => (source && typeof source === "object" ? (source as Record<string, unknown>) : null))
    .filter((source): source is Record<string, unknown> => Boolean(source))
    .map((source) => {
      const url =
        typeof source.uri === "string"
          ? source.uri
          : typeof source.url === "string"
            ? source.url
            : "";

      return {
        sourceType: "hunter" as const,
        url,
        title:
          typeof source.extracted_from === "string"
            ? source.extracted_from
            : typeof source.domain === "string"
              ? source.domain
              : "Hunter source",
        snippet:
          typeof source.value === "string"
            ? source.value
            : typeof source.pattern === "string"
              ? source.pattern
              : "",
        domain: normalizeEvidenceDomain(typeof source.domain === "string" ? source.domain : url),
        extractedOn:
          typeof source.extracted_on === "string"
            ? source.extracted_on
            : typeof source.created_at === "string"
              ? source.created_at
              : "",
        lastSeenOn:
          typeof source.last_seen_on === "string"
            ? source.last_seen_on
            : typeof entry.last_seen_on === "string"
              ? (entry.last_seen_on as string)
              : "",
        stillOnPage: Boolean(source.still_on_page),
      };
    });
}

function extractCompanySnapshot(payload: Record<string, unknown>): HunterCompanySnapshot | null {
  const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null;
  if (!data) return null;

  return {
    company:
      typeof data.organization === "string"
        ? data.organization
        : typeof data.company === "string"
          ? data.company
          : "",
    domain: typeof data.domain === "string" ? normalizeDomain(data.domain) : "",
    description: typeof data.description === "string" ? data.description : "",
    industry: typeof data.industry === "string" ? data.industry : "",
    size:
      typeof data.headcount === "string"
        ? data.headcount
        : typeof data.company_size === "string"
          ? data.company_size
          : "",
    location:
      typeof data.country === "string"
        ? data.country
        : typeof data.location === "string"
          ? data.location
          : "",
    pattern: typeof data.pattern === "string" ? data.pattern : "",
  };
}

function buildCandidateFromHunterEntry(
  entry: Record<string, unknown>,
  roleHint: RecruiterCandidateRole,
  pattern: string
): RecruiterCandidate {
  const firstName = typeof entry.first_name === "string" ? entry.first_name : "";
  const lastName = typeof entry.last_name === "string" ? entry.last_name : "";
  const fullName = `${firstName} ${lastName}`.trim() || (typeof entry.full_name === "string" ? entry.full_name : "");
  const title =
    typeof entry.position_raw === "string"
      ? entry.position_raw
      : typeof entry.position === "string"
        ? entry.position
        : "";
  const linkedinUrl =
    typeof entry.linkedin === "string"
      ? entry.linkedin
      : typeof entry.linkedin_url === "string"
        ? entry.linkedin_url
        : "";
  const verification = entry.verification && typeof entry.verification === "object"
    ? (entry.verification as Record<string, unknown>)
    : null;
  const status = normalizeVerificationStatus(
    typeof verification?.status === "string"
      ? verification.status
      : typeof entry.status === "string"
        ? entry.status
        : ""
  );
  const evidence = parseHunterSources(entry);
  const normalized = normalizeRecruiterCandidate({
    id: `candidate_hunter_${buildHunterCandidateKey(fullName, linkedinUrl, typeof entry.value === "string" ? entry.value : "")}`,
    name: fullName,
    title,
    role: roleHint === "unknown" ? inferCandidateRoleFromTitle(title) : roleHint,
    linkedinUrl,
    linkedinHandle: extractLinkedInHandle(linkedinUrl),
    email: typeof entry.value === "string" ? entry.value : "",
    emailVerificationStatus: status,
    emailConfidence:
      typeof entry.confidence === "number"
        ? entry.confidence
        : typeof entry.score === "number"
          ? entry.score
          : 0,
    domainPattern: pattern,
    reasons: pattern ? [`Hunter pattern ${pattern}`] : [],
    sourceTypes: ["hunter"],
    sourceSummary: `Hunter ${roleHint === "unknown" ? "contact" : roleHint} track`,
    evidence:
      evidence.length > 0
        ? evidence
        : [
            {
              sourceType: "hunter",
              url: linkedinUrl,
              title: "Hunter enrichment",
              snippet: title,
              domain: normalizeEvidenceDomain(linkedinUrl),
              extractedOn: "",
              lastSeenOn: "",
              stillOnPage: false,
            },
          ],
  });

  return normalized;
}

function buildHunterCandidateKey(name: string, linkedinUrl: string, email: string): string {
  return `${name}|${linkedinUrl}|${email}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 96);
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

function sanitizeNamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function applyEmailPattern(pattern: string, firstName: string, lastName: string, domain: string): string {
  const first = sanitizeNamePart(firstName);
  const last = sanitizeNamePart(lastName);
  const f = first.charAt(0);
  const l = last.charAt(0);
  let output = pattern.trim().toLowerCase();

  output = output
    .replace(/{first}/g, first)
    .replace(/{last}/g, last)
    .replace(/{f}/g, f)
    .replace(/{l}/g, l)
    .replace(/\bfirst\b/g, first)
    .replace(/\blast\b/g, last)
    .replace(/\bf\b/g, f)
    .replace(/\bl\b/g, l);

  if (!output.includes("@")) {
    output = `${output}@${domain}`;
  }

  return output;
}

export async function extractDomain(company: string): Promise<string> {
  if (!hasHunterKey() || !company.trim()) return "";

  try {
    const payload = await hunterRequest("/domain-search", { company });
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null;
    return data && typeof data.domain === "string" ? normalizeDomain(data.domain) : "";
  } catch {
    return "";
  }
}

export async function getHunterCompanySnapshot({
  company,
  domain,
}: {
  company?: string;
  domain?: string;
}): Promise<HunterCompanySnapshot | null> {
  if (!hasHunterKey()) return null;

  try {
    const payload = await hunterRequest("/domain-search", {
      company,
      domain,
      limit: 1,
    });
    return extractCompanySnapshot(payload as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function searchHunterContacts(options: HunterSearchOptions): Promise<HunterSearchResult> {
  if (!hasHunterKey() || !options.domain.trim()) {
    return { candidates: [], company: null };
  }

  const allCandidates: RecruiterCandidate[] = [];
  let offset = options.offset || 0;
  let company: HunterCompanySnapshot | null = null;
  const limit = Math.min(options.limit || DEFAULT_LIMIT, DEFAULT_LIMIT);

  while (allCandidates.length < 25) {
    try {
      const baseQuery = {
        domain: normalizeDomain(options.domain),
        department: options.department,
        type: options.type || "personal",
        limit,
        offset,
        verification_status: options.verificationStatuses?.join(",") || undefined,
        required_field: options.requiredFields?.join(",") || undefined,
        seniority: options.seniority?.join(",") || undefined,
      };

      const usePost = Array.isArray(options.jobTitles) && options.jobTitles.length > 0;
      const payload = await hunterRequest(
        "/domain-search",
        usePost ? baseQuery : { ...baseQuery, job_titles: options.jobTitles?.join(",") },
        usePost
          ? {
              method: "POST",
              body: {
                ...baseQuery,
                job_titles: options.jobTitles,
              },
            }
          : {}
      );

      const payloadRecord = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      company = company || extractCompanySnapshot(payloadRecord);

      const data = payloadRecord.data && typeof payloadRecord.data === "object"
        ? (payloadRecord.data as Record<string, unknown>)
        : {};
      const pattern = typeof data.pattern === "string" ? data.pattern : "";
      const emails = Array.isArray(data.emails) ? (data.emails as unknown[]) : [];

      const pageCandidates = emails
        .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => buildCandidateFromHunterEntry(entry, options.roleHint || "unknown", pattern));

      allCandidates.push(...pageCandidates);

      if (emails.length < limit) {
        break;
      }

      offset += emails.length;
    } catch {
      break;
    }
  }

  return {
    candidates: dedupeHunterCandidates(allCandidates).slice(0, 25),
    company,
  };
}

function dedupeHunterCandidates(candidates: RecruiterCandidate[]): RecruiterCandidate[] {
  const seen = new Map<string, RecruiterCandidate>();

  candidates.forEach((candidate) => {
    const key =
      candidate.linkedinUrl.toLowerCase() ||
      candidate.email.toLowerCase() ||
      `${candidate.name}|${candidate.title}`.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, candidate);
      return;
    }

    seen.set(key, normalizeRecruiterCandidate({
      ...existing,
      ...candidate,
      email: candidate.email || existing.email,
      emailVerificationStatus:
        existing.emailVerificationStatus === "valid" || existing.emailVerificationStatus === "accept_all"
          ? existing.emailVerificationStatus
          : candidate.emailVerificationStatus,
      emailConfidence: Math.max(existing.emailConfidence, candidate.emailConfidence),
      domainPattern: candidate.domainPattern || existing.domainPattern,
      reasons: Array.from(new Set([...existing.reasons, ...candidate.reasons])),
      sourceTypes: Array.from(new Set([...existing.sourceTypes, ...candidate.sourceTypes])),
      evidence: [...existing.evidence, ...candidate.evidence].filter(
        (entry, index, array) => array.findIndex((item) => item.url === entry.url && item.title === entry.title) === index
      ),
    }));
  });

  return Array.from(seen.values());
}

export async function findEmail(
  firstName: string,
  lastName: string,
  domain: string
): Promise<{ email: string; confidence: number; verified: boolean; status: EmailVerificationStatus }> {
  if (!hasHunterKey() || !firstName.trim() || !domain.trim()) {
    return { email: "", confidence: 0, verified: false, status: "not_found" };
  }

  try {
    const payload = await hunterRequest("/email-finder", {
      first_name: firstName,
      last_name: lastName,
      domain: normalizeDomain(domain),
    });
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};
    const verification = data.verification && typeof data.verification === "object"
      ? (data.verification as Record<string, unknown>)
      : {};
    const status = normalizeVerificationStatus(
      typeof verification.status === "string"
        ? verification.status
        : typeof data.status === "string"
          ? data.status
          : ""
    );

    return {
      email: typeof data.email === "string" ? data.email : "",
      confidence: typeof data.score === "number" ? data.score : 0,
      verified: status === "valid",
      status,
    };
  } catch {
    return { email: "", confidence: 0, verified: false, status: "not_found" };
  }
}

export async function findEmailByLinkedInHandle(
  linkedinHandle: string,
  domain: string
): Promise<{ email: string; confidence: number; status: EmailVerificationStatus }> {
  if (!hasHunterKey() || !linkedinHandle.trim()) {
    return { email: "", confidence: 0, status: "not_found" };
  }

  try {
    const payload = await hunterRequest("/email-finder", {
      linkedin_handle: linkedinHandle,
      domain: normalizeDomain(domain),
    });
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};
    const verification = data.verification && typeof data.verification === "object"
      ? (data.verification as Record<string, unknown>)
      : {};
    return {
      email: typeof data.email === "string" ? data.email : "",
      confidence: typeof data.score === "number" ? data.score : 0,
      status: normalizeVerificationStatus(
        typeof verification.status === "string"
          ? verification.status
          : typeof data.status === "string"
            ? data.status
            : ""
      ),
    };
  } catch {
    return { email: "", confidence: 0, status: "not_found" };
  }
}

export async function enrichEmailByLinkedInHandle(
  linkedinHandle: string
): Promise<{ email: string; confidence: number; status: EmailVerificationStatus }> {
  if (!hasHunterKey() || !linkedinHandle.trim()) {
    return { email: "", confidence: 0, status: "not_found" };
  }

  try {
    const payload = await hunterRequest("/email-enrichment", {
      linkedin_handle: linkedinHandle,
    });
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};
    return {
      email:
        typeof data.email === "string"
          ? data.email
          : Array.isArray(data.emails) && data.emails.length > 0 && typeof data.emails[0] === "string"
            ? (data.emails[0] as string)
            : "",
      confidence: typeof data.score === "number" ? data.score : 0,
      status: normalizeVerificationStatus(typeof data.status === "string" ? data.status : ""),
    };
  } catch {
    return { email: "", confidence: 0, status: "not_found" };
  }
}

export async function verifyEmail(email: string): Promise<{ valid: boolean; result: string }> {
  if (!hasHunterKey() || !email.trim()) {
    return { valid: false, result: "not_found" };
  }

  try {
    const payload = await hunterRequest("/email-verifier", { email });
    const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};
    const result = typeof data.status === "string" ? data.status : "unknown";
    return {
      valid: result === "valid",
      result,
    };
  } catch {
    return { valid: false, result: "error" };
  }
}

function updateCandidateEmail(
  candidate: RecruiterCandidate,
  email: string,
  confidence: number,
  status: EmailVerificationStatus,
  reason: string
): RecruiterCandidate {
  return normalizeRecruiterCandidate({
    ...candidate,
    email,
    emailConfidence: Math.max(candidate.emailConfidence, confidence),
    emailVerificationStatus: email ? status : candidate.emailVerificationStatus,
    reasons: Array.from(new Set([...candidate.reasons, reason])),
  });
}

export async function resolveCandidateEmail(
  candidate: RecruiterCandidate,
  domain: string
): Promise<CandidateEmailResolution> {
  if (!domain.trim()) {
    return { candidate, method: "not-found" };
  }

  if (
    candidate.email.trim() &&
    (candidate.emailVerificationStatus === "valid" || candidate.emailVerificationStatus === "accept_all")
  ) {
    return { candidate, method: "existing" };
  }

  const linkedinHandle = candidate.linkedinHandle || extractLinkedInHandle(candidate.linkedinUrl);

  if (linkedinHandle) {
    const direct = await findEmailByLinkedInHandle(linkedinHandle, domain);
    if (direct.email) {
      return {
        candidate: updateCandidateEmail(candidate, direct.email, direct.confidence, direct.status, "Resolved via Hunter LinkedIn handle lookup"),
        method: "hunter-direct",
      };
    }

    const enriched = await enrichEmailByLinkedInHandle(linkedinHandle);
    if (enriched.email) {
      return {
        candidate: updateCandidateEmail(candidate, enriched.email, enriched.confidence, enriched.status, "Resolved via Hunter LinkedIn enrichment"),
        method: "hunter-enrichment",
      };
    }
  }

  const { firstName, lastName } = splitName(candidate.name);
  if (firstName) {
    const direct = await findEmail(firstName, lastName, domain);
    if (direct.email) {
      return {
        candidate: updateCandidateEmail(candidate, direct.email, direct.confidence, direct.status, "Resolved via Hunter name lookup"),
        method: "hunter-direct",
      };
    }
  }

  if (firstName && lastName) {
    const attempts = Array.from(
      new Set(
        [candidate.domainPattern, "{first}.{last}", "first.last"]
          .filter(Boolean)
          .map((pattern) => applyEmailPattern(pattern, firstName, lastName, domain))
      )
    ).slice(0, 2);

    for (const email of attempts) {
      const verification = await verifyEmail(email);
      if (verification.valid) {
        return {
          candidate: updateCandidateEmail(candidate, email, 99, "valid", `Verified against Hunter pattern ${candidate.domainPattern || "first.last"}`),
          method: "pattern-verified",
        };
      }
    }
  }

  return { candidate, method: "not-found" };
}

export async function findRecruitersAndManagers(
  domain: string,
  jobDepartment: string
): Promise<{
  name: string;
  email: string;
  title: string;
  linkedinUrl: string;
  confidence: number;
  verified: boolean;
  contactType: "recruiter" | "hiring-manager";
}[]> {
  if (!hasHunterKey() || !domain.trim()) return [];

  const department = mapDepartmentToHunter(jobDepartment);
  const recruiterTrack = await searchHunterContacts({
    domain,
    department: "hr",
    type: "personal",
    verificationStatuses: ["valid", "accept_all"],
    requiredFields: ["full_name", "position"],
    jobTitles: RECRUITER_TITLES,
    roleHint: "recruiter",
  });

  const managerTrack = department && department !== "hr"
    ? await searchHunterContacts({
        domain,
        department,
        type: "personal",
        verificationStatuses: ["valid", "accept_all"],
        requiredFields: ["full_name", "position"],
        seniority: ["senior", "executive"],
        jobTitles: MANAGER_TITLES,
        roleHint: "hiring-manager",
      })
    : { candidates: [] as RecruiterCandidate[], company: recruiterTrack.company };

  return [...recruiterTrack.candidates, ...managerTrack.candidates].map((candidate) => ({
    name: candidate.name,
    email: candidate.email,
    title: candidate.title,
    linkedinUrl: candidate.linkedinUrl,
    confidence: candidate.emailConfidence || candidate.score,
    verified: candidate.emailVerificationStatus === "valid",
    contactType: candidate.role === "recruiter" ? "recruiter" : "hiring-manager",
  }));
}

export async function lookupRecruiterEmail(
  recruiter: RecruiterProfile,
  company: string
): Promise<{
  email: string;
  confidence: number;
  method: "hunter-direct" | "hunter-domain" | "pattern-verified" | "not-found";
  verified: boolean;
}> {
  const domain = await extractDomain(company);
  if (!domain) {
    return { email: "", confidence: 0, method: "not-found", verified: false };
  }

  const candidate = normalizeRecruiterCandidate({
    name: recruiter.name,
    title: recruiter.title,
    linkedinUrl: recruiter.linkedinUrl,
    email: recruiter.email,
    emailConfidence: recruiter.confidence,
    emailVerificationStatus: recruiter.email ? "unverified" : "not_found",
    domainPattern: "",
    sourceTypes: ["manual"],
    sourceSummary: recruiter.source,
    evidence: [],
  });

  const result = await resolveCandidateEmail(candidate, domain);
  return {
    email: result.candidate.email,
    confidence: result.candidate.emailConfidence,
    method:
      result.method === "hunter-enrichment"
        ? "hunter-domain"
        : result.method === "existing"
          ? "hunter-domain"
          : result.method,
    verified: result.candidate.emailVerificationStatus === "valid",
  };
}
