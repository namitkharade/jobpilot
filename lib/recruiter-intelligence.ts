import { createHash } from "crypto";

import {
  CompanyIntel,
  JobListing,
  JobTargetProfile,
  OutreachChannel,
  RecruiterCandidate,
  RecruiterCandidateRole,
  RecruiterResearchResult,
  ResearchEvidence,
} from "@/types";
import {
  getSelectedRecruiterCandidate,
  inferCandidateRoleFromTitle,
  normalizeRecruiterCandidate,
  normalizeResearchEvidence,
  projectLegacyRecruiterFields,
} from "./job-normalize";
import {
  extractDomain,
  getHunterCompanySnapshot,
  hasHunterKey,
  mapDepartmentToHunter,
  resolveCandidateEmail,
  searchHunterContacts,
} from "./hunter";
import { getConfiguredSearXNGUrl, searchMultiple, SearchResult } from "./searxng";
import { getOpenAIModel, runStructuredResponse } from "./openai";

const JOB_BOARD_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workday.com",
  "smartrecruiters.com",
] as const;

const STAFFING_TITLES = [
  "staffing",
  "agency",
  "consultant",
  "recruitment consultant",
  "account manager",
  "client partner",
] as const;

const RECRUITER_TERMS = ["recruiter", "talent", "people partner", "sourcer", "acquisition"] as const;
const TARGET_PROFILE_CACHE = new Map<string, JobTargetProfile>();

const JOB_TARGET_PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "discipline",
    "department",
    "targetTitles",
    "seniorityHint",
    "keywords",
    "locationHint",
    "roleFamily",
  ],
  properties: {
    discipline: { type: "string" },
    department: { type: "string" },
    targetTitles: {
      type: "array",
      items: { type: "string" },
    },
    seniorityHint: { type: "string" },
    keywords: {
      type: "array",
      items: { type: "string" },
    },
    locationHint: { type: "string" },
    roleFamily: { type: "string" },
  },
} as const;

const COMPANY_INTEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["officialDomain", "description", "industry", "size", "location", "signals"],
  properties: {
    officialDomain: { type: "string" },
    description: { type: "string" },
    industry: { type: "string" },
    size: { type: "string" },
    location: { type: "string" },
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "title", "snippet"],
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          snippet: { type: "string" },
        },
      },
    },
  },
} as const;

const SEARCH_SYNTHESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "title", "role", "linkedinUrl", "sourceSummary", "evidenceUrls"],
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          role: {
            type: "string",
            enum: ["recruiter", "hiring-manager", "department-head", "job-poster", "legacy", "unknown"],
          },
          linkedinUrl: { type: "string" },
          sourceSummary: { type: "string" },
          evidenceUrls: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

const RERANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["adjustments"],
  properties: {
    adjustments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateId", "delta", "reason"],
        properties: {
          candidateId: { type: "string" },
          delta: { type: "number" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean).map((value) => value.trim()).filter(Boolean)));
}

function daysSince(dateString: string): number {
  if (!dateString) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(dateString).getTime();
  if (Number.isNaN(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

function isFresh(dateString: string, maxDays: number): boolean {
  return daysSince(dateString) <= maxDays;
}

function getHostname(url: string): string {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return "";
  }
}

function isBlockedDomain(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return JOB_BOARD_DOMAINS.some((blocked) => normalized.endsWith(blocked));
}

function parseCompanyDomainFromApplyUrl(applyUrl: string): string {
  const host = getHostname(applyUrl);
  if (!host || isBlockedDomain(host)) return "";
  return host;
}

function fallbackTargetProfile(jobDescription: string, role: string): JobTargetProfile {
  const normalizedRole = role.trim();
  const keywords = uniqueStrings(
    [normalizedRole, ...jobDescription.split(/[\n,.;:()\-]/)]
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 3)
      .slice(0, 8)
  ).slice(0, 6);

  const department =
    normalizedRole.toLowerCase().includes("engineer")
      ? "engineering"
      : normalizedRole.toLowerCase().includes("product")
        ? "product"
        : normalizedRole.toLowerCase().includes("designer")
          ? "design"
          : "";

  return {
    discipline: department || normalizedRole,
    department,
    targetTitles: uniqueStrings([normalizedRole, department ? `${department} manager` : "recruiter"]).slice(0, 4),
    seniorityHint: "",
    keywords,
    locationHint: "",
    roleFamily: normalizedRole,
  };
}

async function buildJobTargetProfile(jobDescription: string, role: string, companyDescription: string) {
  const cacheKey = hashString(`${role}::${jobDescription}::${companyDescription}`);
  const cached = TARGET_PROFILE_CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    const result = await runStructuredResponse<JobTargetProfile>({
      schemaName: "job_target_profile",
      schema: JOB_TARGET_PROFILE_SCHEMA,
      instructions:
        "Extract the hiring target profile from the job description. Keep target titles short and realistic for who could own hiring for the role.",
      input: [
        `Role: ${role}`,
        `Company description: ${companyDescription || "Not provided"}`,
        `Job description:\n${jobDescription.slice(0, 12000)}`,
      ].join("\n\n"),
      model: getOpenAIModel("fast"),
      allowChatFallback: true,
    });
    TARGET_PROFILE_CACHE.set(cacheKey, result.data);
    return result.data;
  } catch {
    const fallback = fallbackTargetProfile(jobDescription, role);
    TARGET_PROFILE_CACHE.set(cacheKey, fallback);
    return fallback;
  }
}

function buildEvidenceFromApplyUrl(applyUrl: string, sourceType: ResearchEvidence["sourceType"], snippet: string): ResearchEvidence[] {
  if (!applyUrl) return [];
  return [
    normalizeResearchEvidence({
      sourceType,
      url: applyUrl,
      title: "Application page",
      snippet,
      domain: getHostname(applyUrl),
      extractedOn: new Date().toISOString(),
      lastSeenOn: new Date().toISOString(),
      stillOnPage: true,
    }),
  ];
}

function buildFirstPartyCandidates(job: JobListing): RecruiterCandidate[] {
  if (!job.jobPosterName.trim()) return [];

  return [
    normalizeRecruiterCandidate({
      id: `candidate_first_party_${hashString(`${job.id}:${job.jobPosterName}:${job.jobPosterTitle}`)}`,
      name: job.jobPosterName,
      title: job.jobPosterTitle,
      role:
        job.jobPosterTitle.trim()
          ? inferCandidateRoleFromTitle(job.jobPosterTitle)
          : "job-poster",
      linkedinUrl: job.recruiterProfileUrl,
      email: "",
      emailVerificationStatus: "not_found",
      emailConfidence: 0,
      domainPattern: "",
      reasons: ["First-party job poster signal"],
      sourceTypes: [job.applyUrl ? "apply-url" : "job-poster"],
      sourceSummary: "Captured from the job listing or apply flow",
      evidence: buildEvidenceFromApplyUrl(
        job.applyUrl,
        job.applyUrl ? "apply-url" : "job-poster",
        `${job.jobPosterName}${job.jobPosterTitle ? ` - ${job.jobPosterTitle}` : ""}`
      ),
    }),
  ];
}

function createCompanyIntelFallback(job: JobListing, domain: string): CompanyIntel | null {
  const signals = buildEvidenceFromApplyUrl(job.applyUrl, "apply-url", `${job.company} careers page`);
  if (!domain && !job.companyDescription.trim() && signals.length === 0) return null;

  return {
    domain,
    description: job.companyDescription || "",
    industry: "",
    size: "",
    location: job.location || "",
    signals,
    updatedAt: new Date().toISOString(),
  };
}

async function buildCompanyIntel(job: JobListing, domain: string): Promise<CompanyIntel | null> {
  if (job.companyIntel && job.companyIntel.domain === domain && isFresh(job.companyIntel.updatedAt, 14)) {
    return job.companyIntel;
  }

  const hunterCompany = domain ? await getHunterCompanySnapshot({ domain }) : await getHunterCompanySnapshot({ company: job.company });

  try {
    const result = await runStructuredResponse<{
      officialDomain: string;
      description: string;
      industry: string;
      size: string;
      location: string;
      signals: Array<{ url: string; title: string; snippet: string }>;
    }>({
      schemaName: "company_intel",
      schema: COMPANY_INTEL_SCHEMA,
      instructions:
        "Research the company's official website and current public company context. Prefer official pages and grounded evidence. Keep each snippet short.",
      input: [
        `Company: ${job.company}`,
        `Known domain: ${domain || "Unknown"}`,
        `Role being targeted: ${job.title}`,
        `Existing company description: ${job.companyDescription || "None"}`,
      ].join("\n"),
      model: getOpenAIModel("draft"),
      webSearch: true,
      searchContextSize: "medium",
      verbosity: "low",
    });

    return {
      domain: normalizeDomain(result.data.officialDomain || domain || hunterCompany?.domain || ""),
      description: result.data.description || hunterCompany?.description || job.companyDescription || "",
      industry: result.data.industry || hunterCompany?.industry || "",
      size: result.data.size || hunterCompany?.size || "",
      location: result.data.location || hunterCompany?.location || job.location || "",
      signals: [
        ...result.data.signals.map((signal) =>
          normalizeResearchEvidence({
            sourceType: "openai-web",
            url: signal.url,
            title: signal.title,
            snippet: signal.snippet,
            domain: getHostname(signal.url),
            extractedOn: new Date().toISOString(),
            lastSeenOn: new Date().toISOString(),
            stillOnPage: true,
          })
        ),
        ...buildEvidenceFromApplyUrl(job.applyUrl, "apply-url", `${job.company} application page`),
      ].filter(
        (signal, index, array) => array.findIndex((entry) => entry.url === signal.url && entry.title === signal.title) === index
      ),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    if (hunterCompany) {
      return {
        domain: normalizeDomain(domain || hunterCompany.domain),
        description: hunterCompany.description || job.companyDescription || "",
        industry: hunterCompany.industry || "",
        size: hunterCompany.size || "",
        location: hunterCompany.location || job.location || "",
        signals: buildEvidenceFromApplyUrl(job.applyUrl, "apply-url", `${job.company} application page`),
        updatedAt: new Date().toISOString(),
      };
    }
    return createCompanyIntelFallback(job, domain);
  }
}

async function resolveCompanyDomain(job: JobListing): Promise<string> {
  if (job.companyDomain.trim()) return normalizeDomain(job.companyDomain);

  const applyDomain = parseCompanyDomainFromApplyUrl(job.applyUrl);
  if (applyDomain) return applyDomain;

  const hunterDomain = await extractDomain(job.company);
  if (hunterDomain) return hunterDomain;

  try {
    const result = await runStructuredResponse<{ officialDomain: string }>({
      schemaName: "company_domain_lookup",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["officialDomain"],
        properties: {
          officialDomain: { type: "string" },
        },
      },
      instructions: "Find the company's official web domain. Return only the canonical domain without protocol.",
      input: `Company: ${job.company}\nRole: ${job.title}\nApplication URL: ${job.applyUrl || "None"}`,
      model: getOpenAIModel("draft"),
      webSearch: true,
      searchContextSize: "low",
      verbosity: "low",
    });
    const domain = normalizeDomain(result.data.officialDomain);
    if (domain) return domain;
  } catch {
    // Ignore and try SearXNG next.
  }

  const searxngUrl = getConfiguredSearXNGUrl();
  if (!searxngUrl) return "";

  const results = await searchMultiple([`${job.company} official site`, `${job.company} careers`], 3);
  for (const result of results) {
    const domain = parseCompanyDomainFromApplyUrl(result.url);
    if (domain) return domain;
  }

  return "";
}

function dedupeCandidates(candidates: RecruiterCandidate[]): RecruiterCandidate[] {
  const map = new Map<string, RecruiterCandidate>();

  candidates.forEach((candidate) => {
    if (!candidate.name.trim() && !candidate.email.trim() && !candidate.linkedinUrl.trim()) {
      return;
    }

    const key =
      candidate.linkedinUrl.toLowerCase() ||
      candidate.email.toLowerCase() ||
      `${candidate.name}|${candidate.title}`.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, candidate);
      return;
    }

    map.set(
      key,
      normalizeRecruiterCandidate({
        ...existing,
        ...candidate,
        email: existing.email || candidate.email,
        emailVerificationStatus:
          existing.emailVerificationStatus === "valid" || existing.emailVerificationStatus === "accept_all"
            ? existing.emailVerificationStatus
            : candidate.emailVerificationStatus,
        emailConfidence: Math.max(existing.emailConfidence, candidate.emailConfidence),
        domainPattern: existing.domainPattern || candidate.domainPattern,
        reasons: uniqueStrings([...existing.reasons, ...candidate.reasons]),
        sourceTypes: Array.from(new Set([...existing.sourceTypes, ...candidate.sourceTypes])),
        sourceSummary: uniqueStrings([existing.sourceSummary, candidate.sourceSummary]).join(" | "),
        evidence: [...existing.evidence, ...candidate.evidence].filter(
          (evidence, index, array) =>
            array.findIndex((entry) => entry.url === evidence.url && entry.title === evidence.title) === index
        ),
      })
    );
  });

  return Array.from(map.values());
}

function matchRole(candidate: RecruiterCandidate, targetProfile: JobTargetProfile): boolean {
  const title = `${candidate.title} ${candidate.role}`.toLowerCase();
  return (
    RECRUITER_TERMS.some((term) => title.includes(term)) ||
    targetProfile.targetTitles.some((targetTitle) => title.includes(targetTitle.toLowerCase())) ||
    (targetProfile.department ? title.includes(targetProfile.department.toLowerCase()) : false)
  );
}

function titleLooksLikeStaffing(title: string): boolean {
  const normalized = title.toLowerCase();
  return STAFFING_TITLES.some((term) => normalized.includes(term));
}

function titleDepartmentMismatch(title: string, department: string): boolean {
  if (!department) return false;
  const normalized = title.toLowerCase();
  const departmentLower = department.toLowerCase();
  if (departmentLower.includes("engineering")) {
    return ["sales", "finance", "marketing", "legal"].some((term) => normalized.includes(term));
  }
  if (departmentLower.includes("marketing")) {
    return ["engineering", "finance", "legal"].some((term) => normalized.includes(term));
  }
  return false;
}

function hasFirstPartySignal(candidate: RecruiterCandidate): boolean {
  return candidate.sourceTypes.includes("job-poster") || candidate.sourceTypes.includes("apply-url");
}

function getLatestEvidenceAge(candidate: RecruiterCandidate): number {
  const ages = candidate.evidence.map((entry) => Math.min(daysSince(entry.lastSeenOn), daysSince(entry.extractedOn)));
  if (!ages.length) return Number.POSITIVE_INFINITY;
  return Math.min(...ages);
}

function hasKeywordMatch(candidate: RecruiterCandidate, targetProfile: JobTargetProfile): boolean {
  const haystack = `${candidate.title} ${candidate.sourceSummary} ${candidate.evidence.map((entry) => entry.snippet).join(" ")}`.toLowerCase();
  return (
    targetProfile.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())) ||
    (targetProfile.department ? haystack.includes(targetProfile.department.toLowerCase()) : false)
  );
}

function scoreCandidate(candidate: RecruiterCandidate, targetProfile: JobTargetProfile) {
  let score = 0;
  const reasons: string[] = [];

  if (candidate.emailVerificationStatus === "valid") {
    score += 25;
    reasons.push("Verified email available");
  } else if (candidate.emailVerificationStatus === "accept_all") {
    score += 15;
    reasons.push("Accept-all email available");
  }

  if (hasFirstPartySignal(candidate)) {
    score += 20;
    reasons.push("First-party poster/apply-page signal");
  }

  if (matchRole(candidate, targetProfile)) {
    score += 15;
    reasons.push("Role/title matches likely hiring owner");
  }

  if (candidate.linkedinUrl) {
    score += 10;
    reasons.push("LinkedIn profile available");
  }

  const latestEvidenceAge = getLatestEvidenceAge(candidate);
  if (latestEvidenceAge <= 365) {
    score += 10;
    reasons.push("Fresh evidence within 365 days");
  } else if (latestEvidenceAge <= 730) {
    score += 5;
    reasons.push("Evidence seen within 730 days");
  }

  if (hasKeywordMatch(candidate, targetProfile)) {
    score += 10;
    reasons.push("Title/evidence matches JD keywords");
  }

  if (titleLooksLikeStaffing(candidate.title)) {
    score -= 20;
    reasons.push("Agency or staffing title penalty");
  }

  if (titleDepartmentMismatch(candidate.title, targetProfile.department)) {
    score -= 15;
    reasons.push("Likely department mismatch");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: uniqueStrings([...candidate.reasons, ...reasons]),
  };
}

function selectBestCandidate(candidates: RecruiterCandidate[]): RecruiterCandidate | null {
  if (!candidates.length) return null;

  const withVerifiedEmail = candidates
    .filter((candidate) => candidate.emailVerificationStatus === "valid" || candidate.emailVerificationStatus === "accept_all")
    .sort((left, right) => right.score - left.score);
  if (withVerifiedEmail.length) return withVerifiedEmail[0];

  const withLinkedIn = candidates
    .filter((candidate) => candidate.linkedinUrl)
    .sort((left, right) => right.score - left.score);
  if (withLinkedIn.length) return withLinkedIn[0];

  return [...candidates].sort((left, right) => right.score - left.score)[0];
}

export function getPreferredChannel(candidate: RecruiterCandidate | null): OutreachChannel {
  if (!candidate) return "blocked";
  if (candidate.email && (candidate.emailVerificationStatus === "valid" || candidate.emailVerificationStatus === "accept_all")) {
    return "email";
  }
  if (!candidate.email && candidate.linkedinUrl) {
    return "linkedin";
  }
  if (!candidate.email && !candidate.linkedinUrl) {
    return "blocked";
  }
  if (candidate.linkedinUrl && candidate.emailVerificationStatus !== "valid" && candidate.emailVerificationStatus !== "accept_all") {
    return "linkedin";
  }
  return "blocked";
}

async function buildCandidatesFromSearchResults(
  job: JobListing,
  targetProfile: JobTargetProfile,
  searchResults: SearchResult[]
): Promise<RecruiterCandidate[]> {
  if (!searchResults.length) return [];

  try {
    const result = await runStructuredResponse<{
      candidates: Array<{
        name: string;
        title: string;
        role: RecruiterCandidateRole;
        linkedinUrl: string;
        sourceSummary: string;
        evidenceUrls: string[];
      }>;
    }>({
      schemaName: "search_contact_synthesis",
      schema: SEARCH_SYNTHESIS_SCHEMA,
      instructions:
        "Extract likely people involved in hiring for the role. Only return real people. Prefer recruiters, hiring managers, or department leaders. Use evidence URLs from the provided snippets.",
      input: [
        `Company: ${job.company}`,
        `Role: ${job.title}`,
        `Department: ${targetProfile.department || "Unknown"}`,
        `Target titles: ${targetProfile.targetTitles.join(", ") || "Unknown"}`,
        "Search snippets:",
        ...searchResults.slice(0, 10).map(
          (result, index) => `[${index + 1}] ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`
        ),
      ].join("\n\n"),
      model: getOpenAIModel("fast"),
      allowChatFallback: true,
    });

    return result.data.candidates
      .map((candidate) => {
        const matchingEvidence = searchResults
          .filter((result) => candidate.evidenceUrls.includes(result.url))
          .map((result) =>
            normalizeResearchEvidence({
              sourceType: "searxng",
              url: result.url,
              title: result.title,
              snippet: result.snippet,
              domain: getHostname(result.url),
              extractedOn: new Date().toISOString(),
              lastSeenOn: new Date().toISOString(),
              stillOnPage: true,
            })
          );

        return normalizeRecruiterCandidate({
          id: `candidate_search_${hashString(`${candidate.name}:${candidate.linkedinUrl}:${candidate.title}`)}`,
          name: candidate.name,
          title: candidate.title,
          role: candidate.role || inferCandidateRoleFromTitle(candidate.title),
          linkedinUrl: candidate.linkedinUrl,
          email: "",
          emailVerificationStatus: "not_found",
          emailConfidence: 0,
          domainPattern: "",
          reasons: ["Synthesized from web search evidence"],
          sourceTypes: ["searxng"],
          sourceSummary: candidate.sourceSummary,
          evidence: matchingEvidence,
        });
      })
      .filter((candidate) => candidate.name && candidate.title);
  } catch {
    return [];
  }
}

function buildFallbackQueries(job: JobListing, targetProfile: JobTargetProfile): string[] {
  const titleFragments = targetProfile.targetTitles.slice(0, 3);
  const titleQuery = titleFragments.length ? `("${titleFragments.join('" OR "')}")` : `"${job.title}"`;
  const department = targetProfile.department || job.title;
  return [
    `"${job.company}" site:linkedin.com/in ("recruiter" OR "talent acquisition" OR "people partner")`,
    `"${job.company}" site:linkedin.com/in "${department}" ("manager" OR "director" OR "head")`,
    `"${job.company}" site:linkedin.com/in ${titleQuery}`,
  ];
}

async function rerankCandidates(
  job: JobListing,
  targetProfile: JobTargetProfile,
  candidates: RecruiterCandidate[]
): Promise<RecruiterCandidate[]> {
  if (candidates.length <= 1) return candidates;

  try {
    const result = await runStructuredResponse<{
      adjustments: Array<{ candidateId: string; delta: number; reason: string }>;
    }>({
      schemaName: "candidate_rerank",
      schema: RERANK_SCHEMA,
      instructions:
        "Adjust candidate scores for who is most likely to help a job seeker reach the right hiring owner. Use small deltas only.",
      input: [
        `Company: ${job.company}`,
        `Role: ${job.title}`,
        `Department: ${targetProfile.department || "Unknown"}`,
        "Candidates:",
        ...candidates.slice(0, 10).map(
          (candidate) =>
            `${candidate.id} | ${candidate.name} | ${candidate.title} | score=${candidate.score} | emailStatus=${candidate.emailVerificationStatus} | reasons=${candidate.reasons.join("; ")}`
        ),
      ].join("\n"),
      model: getOpenAIModel("fast"),
      allowChatFallback: true,
    });

    const adjustmentMap = new Map(
      result.data.adjustments.map((adjustment) => [
        adjustment.candidateId,
        {
          delta: Math.max(-15, Math.min(15, Math.round(adjustment.delta))),
          reason: adjustment.reason,
        },
      ])
    );

    return candidates.map((candidate) => {
      const adjustment = adjustmentMap.get(candidate.id);
      if (!adjustment) return candidate;

      return normalizeRecruiterCandidate({
        ...candidate,
        score: Math.max(0, Math.min(100, candidate.score + adjustment.delta)),
        reasons: uniqueStrings([...candidate.reasons, adjustment.reason]),
      });
    });
  } catch {
    return candidates;
  }
}

function applyScoring(candidates: RecruiterCandidate[], targetProfile: JobTargetProfile): RecruiterCandidate[] {
  return candidates
    .map((candidate) => {
      const scored = scoreCandidate(candidate, targetProfile);
      return normalizeRecruiterCandidate({
        ...candidate,
        score: scored.score,
        reasons: scored.reasons,
      });
    })
    .sort((left, right) => right.score - left.score);
}

export function buildRecruiterResearchUpdate(job: JobListing, result: RecruiterResearchResult): Partial<JobListing> {
  const selected = result.candidates.find((candidate) => candidate.id === result.selectedRecruiterId) || null;
  const nextOutreach = {
    ...job.outreach,
    status: selected ? "researched" : "blocked",
    preferredChannel: getPreferredChannel(selected),
    lastResearchedAt: result.lastResearchedAt,
  } as JobListing["outreach"];

  const legacy = projectLegacyRecruiterFields({
    recruiterCandidates: result.candidates,
    selectedRecruiterId: result.selectedRecruiterId,
    outreach: nextOutreach,
  });

  return {
    companyDomain: result.companyDomain,
    companyIntel: result.companyIntel,
    recruiterCandidates: result.candidates,
    selectedRecruiterId: result.selectedRecruiterId,
    outreach: nextOutreach,
    ...legacy,
  };
}

export async function runRecruiterResearch(
  job: JobListing,
  options: { forceRefresh?: boolean; candidateId?: string } = {}
): Promise<{
  result: RecruiterResearchResult;
  updates: Partial<JobListing>;
  targetProfile: JobTargetProfile;
}> {
  const now = new Date().toISOString();

  if (
    !options.forceRefresh &&
    !options.candidateId &&
    job.recruiterCandidates.length > 0 &&
    isFresh(job.outreach.lastResearchedAt, 7)
  ) {
    const cachedResult: RecruiterResearchResult = {
      companyDomain: job.companyDomain,
      companyIntel: job.companyIntel,
      candidates: job.recruiterCandidates,
      selectedRecruiterId: job.selectedRecruiterId || getSelectedRecruiterCandidate(job)?.id || "",
      lastResearchedAt: job.outreach.lastResearchedAt,
    };

    return {
      result: cachedResult,
      updates: buildRecruiterResearchUpdate(job, cachedResult),
      targetProfile: await buildJobTargetProfile(job.jobDescription, job.title, job.companyDescription),
    };
  }

  const targetProfile = await buildJobTargetProfile(job.jobDescription, job.title, job.companyDescription);
  const companyDomain = await resolveCompanyDomain(job);
  const companyIntel = await buildCompanyIntel(job, companyDomain);

  const firstPartyCandidates = buildFirstPartyCandidates(job);
  const existingCandidates = job.recruiterCandidates;
  const hunterDepartment = mapDepartmentToHunter(targetProfile.department);

  const [recruiterTrack, managerTrack] = await Promise.all([
    hasHunterKey() && companyDomain
      ? searchHunterContacts({
          domain: companyDomain,
          department: "hr",
          type: "personal",
          verificationStatuses: ["valid", "accept_all"],
          requiredFields: ["full_name", "position"],
          jobTitles: ["recruiter", "talent acquisition", "people partner", "technical recruiter"],
          roleHint: "recruiter",
        })
      : Promise.resolve({ candidates: [] as RecruiterCandidate[], company: null }),
    hasHunterKey() && companyDomain && hunterDepartment && hunterDepartment !== "hr"
      ? searchHunterContacts({
          domain: companyDomain,
          department: hunterDepartment,
          type: "personal",
          verificationStatuses: ["valid", "accept_all"],
          requiredFields: ["full_name", "position"],
          seniority: ["senior", "executive"],
          jobTitles: targetProfile.targetTitles.length
            ? targetProfile.targetTitles
            : ["manager", "director", "head of", "vice president"],
          roleHint: "hiring-manager",
        })
      : Promise.resolve({ candidates: [] as RecruiterCandidate[], company: null }),
  ]);

  let candidates = dedupeCandidates([
    ...existingCandidates,
    ...firstPartyCandidates,
    ...recruiterTrack.candidates,
    ...managerTrack.candidates,
  ]);

  candidates = applyScoring(candidates, targetProfile);

  const refreshPool = candidates
    .filter((candidate) => !candidate.email || candidate.emailVerificationStatus === "unverified" || candidate.emailVerificationStatus === "unknown")
    .sort((left, right) => {
      if (options.candidateId && left.id === options.candidateId) return -1;
      if (options.candidateId && right.id === options.candidateId) return 1;
      return right.score - left.score;
    })
    .slice(0, 2);

  if (companyDomain && refreshPool.length > 0) {
    const refreshed = await Promise.all(refreshPool.map((candidate) => resolveCandidateEmail(candidate, companyDomain)));
    const refreshedMap = new Map(refreshed.map((entry) => [entry.candidate.id, entry.candidate]));
    candidates = candidates.map((candidate) => refreshedMap.get(candidate.id) || candidate);
    candidates = applyScoring(candidates, targetProfile);
  }

  const viableCandidates = candidates.filter((candidate) => candidate.score >= 40);
  const hasFreshEvidence = candidates.some((candidate) => getLatestEvidenceAge(candidate) <= 365);

  if ((viableCandidates.length < 3 || !hasFreshEvidence) && getConfiguredSearXNGUrl()) {
    const searchResults = await searchMultiple(buildFallbackQueries(job, targetProfile), 4);
    const searchCandidates = await buildCandidatesFromSearchResults(job, targetProfile, searchResults);
    if (searchCandidates.length > 0) {
      candidates = applyScoring(dedupeCandidates([...candidates, ...searchCandidates]), targetProfile);
    }
  }

  candidates = await rerankCandidates(job, targetProfile, candidates);
  candidates = [...candidates].sort((left, right) => right.score - left.score);

  const selectedCandidate = options.candidateId
    ? candidates.find((candidate) => candidate.id === options.candidateId) || selectBestCandidate(candidates)
    : selectBestCandidate(candidates);

  const result: RecruiterResearchResult = {
    companyDomain: companyDomain || companyIntel?.domain || "",
    companyIntel,
    candidates,
    selectedRecruiterId: selectedCandidate?.id || "",
    lastResearchedAt: now,
  };

  return {
    result,
    updates: buildRecruiterResearchUpdate(job, result),
    targetProfile,
  };
}

export const recruiterIntelligenceTestUtils = {
  isBlockedDomain,
  parseCompanyDomainFromApplyUrl,
  dedupeCandidates,
  scoreCandidate,
};
