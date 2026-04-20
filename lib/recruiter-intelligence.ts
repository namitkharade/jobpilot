import { createHash } from "crypto";

import {
  CompanyIntel,
  HunterProviderStatus,
  JobListing,
  JobTargetProfile,
  OutreachChannel,
  RecruiterCandidate,
  RecruiterCandidateRole,
  RecruiterResearchDebugSummary,
  RecruiterResearchStageSummary,
  RecruiterResearchResult,
  ResearchEvidence,
  SearchProviderStatus,
} from "@/types";
import {
  deriveCandidatePersona,
  getSelectedRecruiterCandidate,
  inferCandidateRoleFromTitle,
  normalizeJobListing,
  normalizeRecruiterCandidate,
  normalizeResearchEvidence,
  projectLegacyRecruiterFields,
} from "./job-normalize";
import { inspectJobPage, JobPageInspection } from "./job-import";
import {
  extractDomain,
  getHunterCompanySnapshot,
  hasHunterKey,
  mapDepartmentToHunter,
  resolveCandidateEmail,
  searchHunterContacts,
} from "./hunter";
import {
  hasConfiguredOpenAI,
  hasConfiguredSearXNG,
  searchMultipleDetailed,
  SearchResult,
} from "./searxng";
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

interface FirstPartyResearchResult {
  job: JobListing;
  candidates: RecruiterCandidate[];
  companyDomain: string;
  domainSource: string;
  warnings: string[];
  evidence: ResearchEvidence[];
  inspection: JobPageInspection | null;
}

interface DomainResolutionResult {
  domain: string;
  source: string;
  warning: string;
  hunterStatus: HunterProviderStatus;
}

interface WebDiscoveryResult {
  candidates: RecruiterCandidate[];
  queries: string[];
  status: SearchProviderStatus;
  warning: string;
}

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

const WEB_DISCOVERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "title", "role", "linkedinUrl", "sourceSummary", "evidence"],
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          role: {
            type: "string",
            enum: ["recruiter", "hiring-manager", "department-head", "job-poster", "legacy", "unknown"],
          },
          linkedinUrl: { type: "string" },
          sourceSummary: { type: "string" },
          evidence: {
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

function createEmptyDebugSummary(): RecruiterResearchDebugSummary {
  return {
    domainSource: "",
    queries: [],
    stages: [],
    enrichmentAttempts: [],
    zeroResultReasons: [],
  };
}

function pushDebugStage(
  debugSummary: RecruiterResearchDebugSummary,
  stage: RecruiterResearchStageSummary
) {
  debugSummary.stages.push({
    ...stage,
    queries: uniqueStrings(stage.queries),
    details: uniqueStrings(stage.details),
  });
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

function mergeHunterStatus(...statuses: HunterProviderStatus[]): HunterProviderStatus {
  if (statuses.includes("auth_failed")) return "auth_failed";
  if (statuses.includes("ok")) return "ok";
  return "unavailable";
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

  const inferredRole =
    job.jobPosterTitle.trim()
      ? inferCandidateRoleFromTitle(job.jobPosterTitle)
      : "job-poster";

  return [
    normalizeRecruiterCandidate({
      id: `candidate_first_party_${hashString(`${job.id}:${job.jobPosterName}:${job.jobPosterTitle}`)}`,
      name: job.jobPosterName,
      title: job.jobPosterTitle,
      role: inferredRole,
      persona: deriveCandidatePersona(inferredRole),
      linkedinUrl: job.recruiterProfileUrl,
      email: "",
      emailVerificationStatus: "not_found",
      emailConfidence: 0,
      emailResolutionMethod: "not-found",
      domainPattern: "",
      reasons: ["First-party job poster signal"],
      sourceTypes: [job.applyUrl ? "apply-url" : "job-poster"],
      sourceSummary: "Captured from the job listing or apply flow",
      discoveryStage: "first-party",
      evidence: buildEvidenceFromApplyUrl(
        job.applyUrl,
        job.applyUrl ? "apply-url" : "job-poster",
        `${job.jobPosterName}${job.jobPosterTitle ? ` - ${job.jobPosterTitle}` : ""}`
      ),
    }),
  ];
}

function buildEvidenceFromInspection(inspection: JobPageInspection, job: JobListing): ResearchEvidence[] {
  const links = [
    inspection.canonicalUrl || inspection.finalUrl || job.applyUrl,
    ...inspection.teamLinks.map((link) => link.url),
  ].filter(Boolean);

  return links.slice(0, 4).map((url, index) =>
    normalizeResearchEvidence({
      sourceType: "apply-url",
      url,
      title:
        index === 0
          ? inspection.pageTitle || "First-party job page"
          : inspection.teamLinks[index - 1]?.text || "First-party company page",
      snippet:
        index === 0
          ? inspection.visibleText.slice(0, 220)
          : `Related first-party page for ${job.company}`,
      domain: getHostname(url),
      extractedOn: new Date().toISOString(),
      lastSeenOn: new Date().toISOString(),
      stillOnPage: true,
    })
  );
}

async function inspectFirstPartySignals(job: JobListing): Promise<FirstPartyResearchResult> {
  if (!job.applyUrl.trim()) {
    return {
      job,
      candidates: buildFirstPartyCandidates(job),
      companyDomain: parseCompanyDomainFromApplyUrl(job.applyUrl),
      domainSource: job.companyDomain ? "stored-company-domain" : "",
      warnings: [],
      evidence: [],
      inspection: null,
    };
  }

  try {
    const inspection = await inspectJobPage(job.applyUrl, { allowAiFallback: false });
    const inspectionEvidence = buildEvidenceFromInspection(inspection, job);
    const structuredWebsiteDomain = inspection.companyWebsiteUrls
      .map((url) => parseCompanyDomainFromApplyUrl(url))
      .find(Boolean) || "";
    const canonicalDomain = parseCompanyDomainFromApplyUrl(inspection.canonicalUrl);
    const finalDomain = parseCompanyDomainFromApplyUrl(inspection.finalUrl);
    const resolvedDomain = canonicalDomain || structuredWebsiteDomain || finalDomain;

    const nextJob = normalizeJobListing({
      ...job,
      applyUrl: inspection.draft.applyUrl || inspection.canonicalUrl || inspection.finalUrl || job.applyUrl,
      companyDescription: job.companyDescription || inspection.draft.companyDescription,
      jobPosterName: job.jobPosterName || inspection.draft.jobPosterName,
      jobPosterTitle: job.jobPosterTitle || inspection.draft.jobPosterTitle,
      companyDomain: job.companyDomain || resolvedDomain,
    });

    const mailtoEmail = inspection.mailtoEmails[0] || "";
    const candidates = buildFirstPartyCandidates(nextJob).map((candidate) =>
      !candidate.email && mailtoEmail
        ? normalizeRecruiterCandidate({
            ...candidate,
            email: mailtoEmail,
            emailVerificationStatus: "unverified",
            emailResolutionMethod: "manual",
            reasons: [...candidate.reasons, "Email captured from first-party page"],
            evidence: [...candidate.evidence, ...inspectionEvidence],
          })
        : normalizeRecruiterCandidate({
            ...candidate,
            evidence: [...candidate.evidence, ...inspectionEvidence],
          })
    );

    return {
      job: nextJob,
      candidates,
      companyDomain: nextJob.companyDomain,
      domainSource:
        canonicalDomain
          ? "first-party-canonical"
          : structuredWebsiteDomain
            ? "first-party-company-website"
            : finalDomain
              ? "first-party-final-url"
              : "",
      warnings: inspection.warnings,
      evidence: inspectionEvidence,
      inspection,
    };
  } catch (error) {
    return {
      job,
      candidates: buildFirstPartyCandidates(job),
      companyDomain: job.companyDomain,
      domainSource: job.companyDomain ? "stored-company-domain" : "",
      warnings: [
        `First-party page inspection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      ],
      evidence: [],
      inspection: null,
    };
  }
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

  const hunterCompanyResult = domain
    ? await getHunterCompanySnapshot({ domain })
    : await getHunterCompanySnapshot({ company: job.company });
  const hunterCompany = hunterCompanyResult.data;

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

async function resolveCompanyDomain(
  job: JobListing,
  firstPartyResult: FirstPartyResearchResult
): Promise<DomainResolutionResult> {
  if (job.companyDomain.trim()) {
    return {
      domain: normalizeDomain(job.companyDomain),
      source: "stored-company-domain",
      warning: "",
      hunterStatus: hasHunterKey() ? "ok" : "unavailable",
    };
  }

  if (firstPartyResult.companyDomain) {
    return {
      domain: normalizeDomain(firstPartyResult.companyDomain),
      source: firstPartyResult.domainSource || "first-party",
      warning: "",
      hunterStatus: hasHunterKey() ? "ok" : "unavailable",
    };
  }

  const applyDomain = parseCompanyDomainFromApplyUrl(job.applyUrl);
  if (applyDomain) {
    return {
      domain: applyDomain,
      source: "apply-url",
      warning: "",
      hunterStatus: hasHunterKey() ? "ok" : "unavailable",
    };
  }

  const hunterDomain = await extractDomain(job.company);
  if (hunterDomain.data) {
    return {
      domain: hunterDomain.data,
      source: "hunter-domain-search",
      warning: hunterDomain.warning,
      hunterStatus: hunterDomain.providerStatus,
    };
  }

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
    if (domain) {
      return {
        domain,
        source: "openai-web-domain",
        warning: hunterDomain.warning,
        hunterStatus: hunterDomain.providerStatus,
      };
    }
  } catch {
    // Ignore and try configured SearXNG next.
  }

  const searxng = await searchMultipleDetailed([`${job.company} official site`, `${job.company} careers`], 3);
  for (const result of searxng.results) {
    const domain = parseCompanyDomainFromApplyUrl(result.url);
    if (domain) {
      return {
        domain,
        source: "searxng-domain",
        warning: searxng.message || hunterDomain.warning,
        hunterStatus: hunterDomain.providerStatus,
      };
    }
  }

  return {
    domain: "",
    source: "",
    warning: searxng.message || hunterDomain.warning,
    hunterStatus: hunterDomain.providerStatus,
  };
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
    score += 28;
    reasons.push("Verified email available");
  } else if (candidate.emailVerificationStatus === "accept_all") {
    score += 18;
    reasons.push("Accept-all email available");
  }

  if (hasFirstPartySignal(candidate)) {
    score += 24;
    reasons.push("First-party poster/apply-page signal");
  }

  if (matchRole(candidate, targetProfile)) {
    score += candidate.role === "department-head" ? 18 : 15;
    reasons.push("Role/title matches likely hiring owner");
  }

  if (candidate.persona === "hiring-manager" || candidate.persona === "department-head") {
    score += 8;
    reasons.push("Likely close to the hiring decision");
  } else if (candidate.persona === "recruiter") {
    score += 6;
    reasons.push("Likely part of the recruiting funnel");
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
    score -= 35;
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
          persona: deriveCandidatePersona(candidate.role || inferCandidateRoleFromTitle(candidate.title)),
          linkedinUrl: candidate.linkedinUrl,
          email: "",
          emailVerificationStatus: "not_found",
          emailConfidence: 0,
          emailResolutionMethod: "not-found",
          domainPattern: "",
          reasons: ["Synthesized from web search evidence"],
          sourceTypes: ["searxng"],
          sourceSummary: candidate.sourceSummary,
          discoveryStage: "web-search",
          evidence: matchingEvidence,
        });
      })
      .filter((candidate) => candidate.name && candidate.title);
  } catch {
    return [];
  }
}

function buildWebDiscoveryQueries(job: JobListing, targetProfile: JobTargetProfile, domain: string): string[] {
  const titleFragments = targetProfile.targetTitles.slice(0, 3);
  const titleQuery = titleFragments.length ? `("${titleFragments.join('" OR "')}")` : `"${job.title}"`;
  const department = targetProfile.department || job.title;
  const domainHint = domain ? `site:${domain}` : "";

  return uniqueStrings([
    `"${job.company}" site:linkedin.com/in ("recruiter" OR "talent acquisition" OR "people partner" OR "technical recruiter")`,
    `"${job.company}" site:linkedin.com/in "${department}" ("manager" OR "director" OR "head" OR "lead")`,
    `"${job.company}" site:linkedin.com/in ${titleQuery}`,
    domainHint ? `"${job.company}" ${domainHint} ("team" OR "leadership" OR "about" OR "people")` : "",
  ]).slice(0, 6);
}

async function discoverCandidatesFromWeb(
  job: JobListing,
  targetProfile: JobTargetProfile,
  companyDomain: string,
  companyIntel: CompanyIntel | null,
  firstPartyResult: FirstPartyResearchResult
): Promise<WebDiscoveryResult> {
  const queries = buildWebDiscoveryQueries(job, targetProfile, companyDomain);
  if (!hasConfiguredOpenAI()) {
    return {
      candidates: [],
      queries,
      status: "unavailable",
      warning: "OpenAI API key missing for web discovery",
    };
  }

  const searxng = hasConfiguredSearXNG()
    ? await searchMultipleDetailed(queries, 3)
    : { results: [] as SearchResult[], status: "unavailable" as SearchProviderStatus, message: "", provider: "" };

  try {
    const result = await runStructuredResponse<{
      candidates: Array<{
        name: string;
        title: string;
        role: RecruiterCandidateRole;
        linkedinUrl: string;
        sourceSummary: string;
        evidence: Array<{ url: string; title: string; snippet: string }>;
      }>;
    }>({
      schemaName: "web_contact_discovery",
      schema: WEB_DISCOVERY_SCHEMA,
      instructions:
        "Find real people connected to hiring for this job. Prefer in-house recruiters, hiring managers, department leads, or senior leaders at the company. Avoid agencies and staffing firms unless no internal people are available. Only return people with grounded public evidence.",
      input: [
        `Company: ${job.company}`,
        `Role: ${job.title}`,
        `Department: ${targetProfile.department || "Unknown"}`,
        `Official domain: ${companyDomain || companyIntel?.domain || "Unknown"}`,
        `Target titles: ${targetProfile.targetTitles.join(", ") || "Unknown"}`,
        `Suggested search queries:\n${queries.map((query) => `- ${query}`).join("\n")}`,
        `Company intel: ${companyIntel?.description || job.companyDescription || "None"}`,
        `First-party clues: ${firstPartyResult.evidence.map((entry) => `${entry.title} (${entry.url})`).join(" | ") || "None"}`,
        searxng.results.length
          ? [
              "Optional SearXNG snippets:",
              ...searxng.results.slice(0, 8).map(
                (entry, index) => `[${index + 1}] ${entry.title}\nURL: ${entry.url}\nSnippet: ${entry.snippet}`
              ),
            ].join("\n\n")
          : "Optional SearXNG snippets: None",
      ].join("\n\n"),
      model: getOpenAIModel("draft"),
      webSearch: true,
      searchContextSize: "medium",
      verbosity: "low",
      allowChatFallback: false,
    });

    const candidates = result.data.candidates
      .map((candidate) => {
        const role = candidate.role || inferCandidateRoleFromTitle(candidate.title);
        return normalizeRecruiterCandidate({
          id: `candidate_web_${hashString(`${candidate.name}:${candidate.linkedinUrl}:${candidate.title}`)}`,
          name: candidate.name,
          title: candidate.title,
          role,
          persona: deriveCandidatePersona(role),
          linkedinUrl: candidate.linkedinUrl,
          email: "",
          emailVerificationStatus: "not_found",
          emailConfidence: 0,
          emailResolutionMethod: "not-found",
          domainPattern: "",
          reasons: ["Synthesized from web search evidence"],
          sourceTypes: ["openai-web", ...(searxng.results.length ? ["searxng"] : [])],
          sourceSummary: candidate.sourceSummary,
          discoveryStage: "web-search",
          evidence: candidate.evidence.map((evidence) =>
            normalizeResearchEvidence({
              sourceType: "openai-web",
              url: evidence.url,
              title: evidence.title,
              snippet: evidence.snippet,
              domain: getHostname(evidence.url),
              extractedOn: new Date().toISOString(),
              lastSeenOn: new Date().toISOString(),
              stillOnPage: true,
            })
          ),
        });
      })
      .filter((candidate) => candidate.name && (candidate.title || candidate.linkedinUrl));

    return {
      candidates,
      queries,
      status: "ok",
      warning:
        searxng.status === "invalid_response"
          ? `Configured SearXNG override returned an invalid response: ${searxng.message}`
          : "",
    };
  } catch (error) {
    return {
      candidates: [],
      queries,
      status: "invalid_response",
      warning: error instanceof Error ? error.message : "Web discovery failed",
    };
  }
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
    applyUrl: job.applyUrl,
    companyDescription: job.companyDescription,
    jobPosterName: job.jobPosterName,
    jobPosterTitle: job.jobPosterTitle,
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
      warnings: [],
      providerStatus: {
        hunter: hasHunterKey() ? "ok" : "unavailable",
        search: hasConfiguredOpenAI() ? "ok" : "unavailable",
      },
      debugSummary: createEmptyDebugSummary(),
    };

    return {
      result: cachedResult,
      updates: buildRecruiterResearchUpdate(job, cachedResult),
      targetProfile: await buildJobTargetProfile(job.jobDescription, job.title, job.companyDescription),
    };
  }

  const warnings: string[] = [];
  const debugSummary = createEmptyDebugSummary();

  const firstPartyResult = await inspectFirstPartySignals(job);
  warnings.push(...firstPartyResult.warnings);
  pushDebugStage(debugSummary, {
    stage: "first-party",
    status: firstPartyResult.warnings.length ? "warning" : "ok",
    source: "job-page-inspection",
    candidateCount: firstPartyResult.candidates.length,
    queries: [],
    details: [
      firstPartyResult.domainSource ? `Resolved first-party domain via ${firstPartyResult.domainSource}` : "",
      ...firstPartyResult.warnings,
    ],
  });

  const workingJob = firstPartyResult.job;
  const targetProfile = await buildJobTargetProfile(
    workingJob.jobDescription,
    workingJob.title,
    workingJob.companyDescription
  );
  const domainResolution = await resolveCompanyDomain(job, firstPartyResult);
  debugSummary.domainSource = domainResolution.source;
  if (domainResolution.warning) {
    warnings.push(domainResolution.warning);
  }

  const companyDomain = domainResolution.domain;
  const companyIntel = await buildCompanyIntel(workingJob, companyDomain);
  const webDiscovery = await discoverCandidatesFromWeb(
    workingJob,
    targetProfile,
    companyDomain,
    companyIntel,
    firstPartyResult
  );
  debugSummary.queries = uniqueStrings([...debugSummary.queries, ...webDiscovery.queries]);
  if (webDiscovery.warning) {
    warnings.push(webDiscovery.warning);
  }
  pushDebugStage(debugSummary, {
    stage: "web-search",
    status:
      webDiscovery.status === "ok"
        ? "ok"
        : webDiscovery.status === "invalid_response"
          ? "warning"
          : "skipped",
    source: "openai-web-search",
    candidateCount: webDiscovery.candidates.length,
    queries: webDiscovery.queries,
    details: [webDiscovery.warning],
  });

  const existingCandidates = workingJob.recruiterCandidates;
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
      : Promise.resolve({
          candidates: [] as RecruiterCandidate[],
          company: null,
          providerStatus: (hasHunterKey() ? "ok" : "unavailable") as HunterProviderStatus,
          warning: hasHunterKey() ? "" : "Hunter API key missing",
        }),
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
      : Promise.resolve({
          candidates: [] as RecruiterCandidate[],
          company: null,
          providerStatus: (hasHunterKey() ? "ok" : "unavailable") as HunterProviderStatus,
          warning: hasHunterKey() ? "" : "Hunter API key missing",
        }),
  ]);

  let hunterStatus = mergeHunterStatus(
    domainResolution.hunterStatus,
    recruiterTrack.providerStatus,
    managerTrack.providerStatus
  );
  warnings.push(...[recruiterTrack.warning, managerTrack.warning].filter(Boolean));
  pushDebugStage(debugSummary, {
    stage: "hunter-search",
    status:
      recruiterTrack.providerStatus === "auth_failed" || managerTrack.providerStatus === "auth_failed"
        ? "warning"
        : hasHunterKey() && companyDomain
          ? "ok"
          : "skipped",
    source: "hunter-domain-search",
    candidateCount: recruiterTrack.candidates.length + managerTrack.candidates.length,
    queries: [],
    details: [recruiterTrack.warning, managerTrack.warning, companyDomain ? `Domain: ${companyDomain}` : "No domain resolved"]
      .filter(Boolean),
  });

  let candidates = dedupeCandidates([
    ...existingCandidates,
    ...firstPartyResult.candidates,
    ...webDiscovery.candidates,
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
    .slice(0, 4);

  if (companyDomain && refreshPool.length > 0) {
    const refreshed = await Promise.all(refreshPool.map((candidate) => resolveCandidateEmail(candidate, companyDomain)));
    refreshed.forEach((entry) => {
      debugSummary.enrichmentAttempts.push({
        candidateId: entry.candidate.id,
        candidateName: entry.candidate.name,
        methods: entry.attemptedMethods,
        resolved: Boolean(entry.candidate.email),
        resolutionMethod: entry.candidate.emailResolutionMethod,
        warning: entry.warning,
      });
      hunterStatus = mergeHunterStatus(hunterStatus, entry.providerStatus);
      if (entry.warning) {
        warnings.push(entry.warning);
      }
    });
    const refreshedMap = new Map(refreshed.map((entry) => [entry.candidate.id, entry.candidate]));
    candidates = candidates.map((candidate) => refreshedMap.get(candidate.id) || candidate);
    candidates = applyScoring(candidates, targetProfile);
    pushDebugStage(debugSummary, {
      stage: "email-enrichment",
      status: refreshed.some((entry) => entry.candidate.email) ? "ok" : "warning",
      source: "hunter-email-resolution",
      candidateCount: refreshed.filter((entry) => entry.candidate.email).length,
      queries: [],
      details: refreshed.map((entry) => `${entry.candidate.name || entry.candidate.id}: ${entry.method}`),
    });
  } else {
    pushDebugStage(debugSummary, {
      stage: "email-enrichment",
      status: "skipped",
      source: "hunter-email-resolution",
      candidateCount: 0,
      queries: [],
      details: [companyDomain ? "No candidates needed enrichment" : "No domain available for enrichment"],
    });
  }

  candidates = await rerankCandidates(job, targetProfile, candidates);
  candidates = [...candidates].sort((left, right) => right.score - left.score);
  pushDebugStage(debugSummary, {
    stage: "selection",
    status: candidates.length ? "ok" : "warning",
    source: "score-and-rerank",
    candidateCount: candidates.length,
    queries: [],
    details: candidates.slice(0, 5).map((candidate) => `${candidate.name || candidate.id}: score=${candidate.score}`),
  });

  const selectedCandidate = options.candidateId
    ? candidates.find((candidate) => candidate.id === options.candidateId) || selectBestCandidate(candidates)
    : selectBestCandidate(candidates);

  if (!companyDomain) {
    debugSummary.zeroResultReasons.push("No company domain could be resolved.");
  }
  if (webDiscovery.status !== "ok") {
    debugSummary.zeroResultReasons.push(
      webDiscovery.status === "unavailable"
        ? "Web discovery was unavailable."
        : "Web discovery returned an invalid response."
    );
  }
  if (hunterStatus === "auth_failed") {
    debugSummary.zeroResultReasons.push("Hunter authentication failed.");
  }
  if (!candidates.length) {
    debugSummary.zeroResultReasons.push("No recruiter or hiring-manager candidates were identified.");
  }
  if (!candidates.some((candidate) => candidate.email)) {
    debugSummary.zeroResultReasons.push("No candidate email could be resolved.");
  }

  const result: RecruiterResearchResult = {
    companyDomain: companyDomain || companyIntel?.domain || "",
    companyIntel,
    candidates,
    selectedRecruiterId: selectedCandidate?.id || "",
    lastResearchedAt: now,
    warnings: uniqueStrings(warnings),
    providerStatus: {
      hunter: hunterStatus,
      search: webDiscovery.status,
    },
    debugSummary: {
      ...debugSummary,
      queries: uniqueStrings(debugSummary.queries),
      zeroResultReasons: uniqueStrings(debugSummary.zeroResultReasons),
    },
  };

  return {
    result,
    updates: buildRecruiterResearchUpdate(workingJob, result),
    targetProfile,
  };
}

export async function runRecruiterResearchDebug(job: JobListing): Promise<{
  result: RecruiterResearchResult;
  targetProfile: JobTargetProfile;
}> {
  const { result, targetProfile } = await runRecruiterResearch(job, { forceRefresh: true });
  return {
    result,
    targetProfile,
  };
}

export const recruiterIntelligenceTestUtils = {
  isBlockedDomain,
  parseCompanyDomainFromApplyUrl,
  dedupeCandidates,
  scoreCandidate,
};
