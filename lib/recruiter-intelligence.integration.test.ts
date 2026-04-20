import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspectJobPageMock: vi.fn(),
  extractDomainMock: vi.fn(),
  getHunterCompanySnapshotMock: vi.fn(),
  hasHunterKeyMock: vi.fn(),
  mapDepartmentToHunterMock: vi.fn(),
  resolveCandidateEmailMock: vi.fn(),
  searchHunterContactsMock: vi.fn(),
  hasConfiguredOpenAIMock: vi.fn(),
  hasConfiguredSearXNGMock: vi.fn(),
  searchMultipleDetailedMock: vi.fn(),
  runStructuredResponseMock: vi.fn(),
  getOpenAIModelMock: vi.fn(),
}));

vi.mock("./job-import", () => ({
  inspectJobPage: mocks.inspectJobPageMock,
}));

vi.mock("./hunter", () => ({
  extractDomain: mocks.extractDomainMock,
  getHunterCompanySnapshot: mocks.getHunterCompanySnapshotMock,
  hasHunterKey: mocks.hasHunterKeyMock,
  mapDepartmentToHunter: mocks.mapDepartmentToHunterMock,
  resolveCandidateEmail: mocks.resolveCandidateEmailMock,
  searchHunterContacts: mocks.searchHunterContactsMock,
}));

vi.mock("./searxng", () => ({
  hasConfiguredOpenAI: mocks.hasConfiguredOpenAIMock,
  hasConfiguredSearXNG: mocks.hasConfiguredSearXNGMock,
  searchMultipleDetailed: mocks.searchMultipleDetailedMock,
}));

vi.mock("./openai", () => ({
  getOpenAIModel: mocks.getOpenAIModelMock,
  runStructuredResponse: mocks.runStructuredResponseMock,
}));

import { normalizeJobListing, normalizeRecruiterCandidate } from "./job-normalize";
import { runRecruiterResearch } from "./recruiter-intelligence";

function createJob(overrides: Partial<ReturnType<typeof normalizeJobListing>> = {}) {
  return normalizeJobListing({
    id: "job_1",
    title: "Senior Backend Engineer",
    company: "Acme",
    location: "Berlin",
    salary: "",
    jobType: "Full-time",
    postedAt: "2026-04-01T00:00:00.000Z",
    scrapedAt: "2026-04-01T00:00:00.000Z",
    applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
    jobDescription: "Build backend platform services in TypeScript and distributed systems.",
    companyDescription: "",
    atsScore: null,
    atsKeywordGaps: [],
    atsSuggestions: [],
    status: "saved",
    companyDomain: "",
    companyIntel: null,
    recruiterCandidates: [],
    selectedRecruiterId: "",
    outreach: {
      status: "idle",
      preferredChannel: "blocked",
      selectedDraftId: "",
      drafts: [],
      brief: null,
      lastResearchedAt: "",
      lastDraftedAt: "",
      lastSentAt: "",
    },
    recruiterName: "",
    recruiterTitle: "",
    recruiterProfileUrl: "",
    recruiterEmail: "",
    emailDraft: "",
    jobPosterName: "",
    jobPosterTitle: "",
    source: "linkedin",
    ...overrides,
  });
}

function mockStructuredResponses(options: {
  companyDomain?: string;
  webCandidates?: Array<{ name: string; title: string; role: "recruiter" | "hiring-manager" | "department-head"; linkedinUrl: string }>;
  throwWebDiscovery?: boolean;
}) {
  mocks.runStructuredResponseMock.mockImplementation(async ({ schemaName }: { schemaName: string }) => {
    if (schemaName === "job_target_profile") {
      return {
        data: {
          discipline: "engineering",
          department: "engineering",
          targetTitles: ["engineering manager", "technical recruiter"],
          seniorityHint: "senior",
          keywords: ["typescript", "platform", "backend"],
          locationHint: "Berlin",
          roleFamily: "software engineering",
        },
      };
    }

    if (schemaName === "company_intel") {
      return {
        data: {
          officialDomain: options.companyDomain || "acme.com",
          description: "Acme builds infrastructure tools.",
          industry: "Software",
          size: "201-500",
          location: "Berlin",
          signals: [],
        },
      };
    }

    if (schemaName === "company_domain_lookup") {
      return {
        data: {
          officialDomain: options.companyDomain || "acme.com",
        },
      };
    }

    if (schemaName === "web_contact_discovery") {
      if (options.throwWebDiscovery) {
        throw new Error("web discovery failed");
      }

      return {
        data: {
          candidates: (options.webCandidates || []).map((candidate) => ({
            ...candidate,
            sourceSummary: "Public company and LinkedIn evidence",
            evidence: [
              {
                url: "https://www.linkedin.com/in/example/",
                title: "LinkedIn",
                snippet: `${candidate.name} works at Acme`,
              },
            ],
          })),
        },
      };
    }

    if (schemaName === "candidate_rerank") {
      return { data: { adjustments: [] } };
    }

    throw new Error(`Unexpected schema ${schemaName}`);
  });
}

describe("recruiter intelligence integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.inspectJobPageMock.mockResolvedValue({
      finalUrl: "https://boards.greenhouse.io/acme/jobs/1",
      canonicalUrl: "https://boards.greenhouse.io/acme/jobs/1",
      extractedVia: "structured-data",
      draft: {
        title: "Senior Backend Engineer",
        company: "Acme",
        location: "Berlin",
        salary: "",
        jobType: "Full-time",
        source: "manual",
        applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
        jobDescription: "Build backend platform services.",
        companyDescription: "",
        postedAt: "",
        jobPosterName: "",
        jobPosterTitle: "",
      },
      warnings: [],
      visibleText: "Join Acme and build backend systems.",
      pageTitle: "Acme Careers",
      mailtoEmails: [],
      teamLinks: [],
      companyWebsiteUrls: [],
    });

    mocks.extractDomainMock.mockResolvedValue({ data: "acme.com", providerStatus: "ok", warning: "" });
    mocks.getHunterCompanySnapshotMock.mockResolvedValue({ data: null, providerStatus: "ok", warning: "" });
    mocks.hasHunterKeyMock.mockReturnValue(true);
    mocks.mapDepartmentToHunterMock.mockReturnValue("engineering");
    mocks.resolveCandidateEmailMock.mockImplementation(async (candidate: ReturnType<typeof normalizeRecruiterCandidate>) => ({
      candidate,
      method: "not-found",
      providerStatus: "ok",
      warning: "",
      attemptedMethods: ["name-domain"],
    }));
    mocks.searchHunterContactsMock.mockResolvedValue({ candidates: [], company: null, providerStatus: "ok", warning: "" });
    mocks.hasConfiguredOpenAIMock.mockReturnValue(true);
    mocks.hasConfiguredSearXNGMock.mockReturnValue(false);
    mocks.searchMultipleDetailedMock.mockResolvedValue({ results: [], status: "unavailable", message: "", provider: "" });
    mocks.getOpenAIModelMock.mockReturnValue("gpt-5.4-mini");
  });

  it("prefers first-party company domain and poster signals before Hunter lookup", async () => {
    mocks.inspectJobPageMock.mockResolvedValue({
      finalUrl: "https://boards.greenhouse.io/acme/jobs/1",
      canonicalUrl: "https://careers.acme.com/jobs/1",
      extractedVia: "structured-data",
      draft: {
        title: "Senior Backend Engineer",
        company: "Acme",
        location: "Berlin",
        salary: "",
        jobType: "Full-time",
        source: "manual",
        applyUrl: "https://careers.acme.com/jobs/1",
        jobDescription: "Build backend platform services.",
        companyDescription: "Acme builds infrastructure tooling.",
        postedAt: "",
        jobPosterName: "Ava Recruiter",
        jobPosterTitle: "Talent Acquisition Partner",
      },
      warnings: [],
      visibleText: "Meet our team.",
      pageTitle: "Acme Careers",
      mailtoEmails: ["ava@acme.com"],
      teamLinks: [{ url: "https://acme.com/team", text: "Team" }],
      companyWebsiteUrls: ["https://acme.com"],
    });
    mockStructuredResponses({ companyDomain: "acme.com", webCandidates: [] });

    const { result, updates } = await runRecruiterResearch(createJob(), { forceRefresh: true });

    expect(result.companyDomain).toBe("careers.acme.com");
    expect(result.debugSummary.domainSource).toBe("first-party-canonical");
    expect(mocks.extractDomainMock).not.toHaveBeenCalled();
    expect(result.candidates[0]?.name).toBe("Ava Recruiter");
    expect(result.candidates[0]?.email).toBe("ava@acme.com");
    expect(result.candidates[0]?.discoveryStage).toBe("first-party");
    expect(updates.jobPosterName).toBe("Ava Recruiter");
  });

  it("enriches web-discovered candidates with email in the same run", async () => {
    mockStructuredResponses({
      companyDomain: "acme.com",
      webCandidates: [
        {
          name: "Morgan Smith",
          title: "Engineering Manager",
          role: "hiring-manager",
          linkedinUrl: "https://www.linkedin.com/in/morgan-smith/",
        },
      ],
    });
    mocks.resolveCandidateEmailMock.mockImplementation(async (candidate: ReturnType<typeof normalizeRecruiterCandidate>) => ({
      candidate: normalizeRecruiterCandidate({
        ...candidate,
        email: "morgan@acme.com",
        emailVerificationStatus: "valid",
        emailConfidence: 96,
        emailResolutionMethod: "hunter-direct",
        reasons: [...candidate.reasons, "Resolved via Hunter name lookup"],
      }),
      method: "hunter-direct",
      providerStatus: "ok",
      warning: "",
      attemptedMethods: ["name-domain"],
    }));

    const { result } = await runRecruiterResearch(createJob(), { forceRefresh: true });
    const candidate = result.candidates.find((entry) => entry.name === "Morgan Smith");

    expect(candidate?.email).toBe("morgan@acme.com");
    expect(candidate?.emailResolutionMethod).toBe("hunter-direct");
    expect(result.debugSummary.enrichmentAttempts).toHaveLength(1);
    expect(result.providerStatus.search).toBe("ok");
  });

  it("surfaces Hunter auth failures while keeping web candidates available", async () => {
    mocks.extractDomainMock.mockResolvedValue({ data: "", providerStatus: "auth_failed", warning: "Unauthorized" });
    mocks.searchHunterContactsMock.mockResolvedValue({ candidates: [], company: null, providerStatus: "auth_failed", warning: "Unauthorized" });
    mocks.resolveCandidateEmailMock.mockImplementation(async (candidate: ReturnType<typeof normalizeRecruiterCandidate>) => ({
      candidate,
      method: "not-found",
      providerStatus: "auth_failed",
      warning: "Unauthorized",
      attemptedMethods: ["name-domain"],
    }));
    mockStructuredResponses({
      companyDomain: "acme.com",
      webCandidates: [
        {
          name: "Jamie Rivera",
          title: "Senior Engineering Manager",
          role: "hiring-manager",
          linkedinUrl: "https://www.linkedin.com/in/jamie-rivera/",
        },
      ],
    });

    const { result } = await runRecruiterResearch(createJob(), { forceRefresh: true });

    expect(result.providerStatus.hunter).toBe("auth_failed");
    expect(result.warnings.some((warning) => warning.includes("Unauthorized"))).toBe(true);
    expect(result.candidates.some((candidate) => candidate.name === "Jamie Rivera")).toBe(true);
    expect(result.debugSummary.zeroResultReasons).toContain("No candidate email could be resolved.");
  });

  it("falls back to Hunter candidates when web discovery is broken", async () => {
    mocks.searchMultipleDetailedMock.mockResolvedValue({
      results: [],
      status: "invalid_response",
      message: "SearXNG did not return JSON search results",
      provider: "https://search.example",
    });
    mocks.searchHunterContactsMock.mockResolvedValue({
      candidates: [
        normalizeRecruiterCandidate({
          name: "Taylor Recruiter",
          title: "Technical Recruiter",
          role: "recruiter",
          persona: "recruiter",
          linkedinUrl: "https://www.linkedin.com/in/taylor-recruiter/",
          email: "",
          emailVerificationStatus: "not_found",
          emailConfidence: 0,
          emailResolutionMethod: "not-found",
          discoveryStage: "hunter-search",
          sourceTypes: ["hunter"],
          sourceSummary: "Hunter recruiter track",
          reasons: ["Hunter directory contact"],
          evidence: [],
        }),
      ],
      company: null,
      providerStatus: "ok",
      warning: "",
    });
    mockStructuredResponses({ companyDomain: "acme.com", throwWebDiscovery: true });

    const { result } = await runRecruiterResearch(createJob(), { forceRefresh: true });

    expect(result.providerStatus.search).toBe("invalid_response");
    expect(result.candidates.some((candidate) => candidate.name === "Taylor Recruiter")).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("web discovery failed"))).toBe(true);
  });
});
