import { beforeEach, describe, expect, it, vi } from "vitest";

const getAllJobsMock = vi.fn();
const runRecruiterResearchDebugMock = vi.fn();

vi.mock("@/lib/job-store", () => ({
  getAllJobs: getAllJobsMock,
}));

vi.mock("@/lib/recruiter-intelligence", () => ({
  runRecruiterResearchDebug: runRecruiterResearchDebugMock,
}));

describe("recruiter debug route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllJobsMock.mockResolvedValue([]);
    runRecruiterResearchDebugMock.mockResolvedValue({
      targetProfile: {
        discipline: "engineering",
        department: "engineering",
        targetTitles: ["engineering manager"],
        seniorityHint: "senior",
        keywords: ["typescript"],
        locationHint: "Berlin",
        roleFamily: "software engineering",
      },
      result: {
        companyDomain: "acme.com",
        companyIntel: null,
        candidates: [],
        selectedRecruiterId: "",
        lastResearchedAt: "2026-04-07T00:00:00.000Z",
        warnings: ["Hunter authentication failed"],
        providerStatus: {
          hunter: "auth_failed",
          search: "ok",
        },
        debugSummary: {
          domainSource: "openai-web-domain",
          queries: ["Acme recruiter linkedin"],
          stages: [],
          enrichmentAttempts: [],
          zeroResultReasons: ["No candidate email could be resolved."],
        },
      },
    });
  });

  it("returns structured recruiter debug output", async () => {
    const route = await import("./route");
    const response = await route.POST(
      new Request("http://localhost/api/recruiter/debug", {
        method: "POST",
        body: JSON.stringify({
          company: "Acme",
          role: "Senior Backend Engineer",
          jobDescription: "Build backend systems.",
          applyUrl: "https://careers.acme.com/jobs/1",
        }),
      }) as never
    );

    const body = (await response.json()) as {
      success: boolean;
      debug: {
        companyDomain: string;
        candidateCount: number;
        warnings: string[];
        providerStatus: {
          hunter: string;
          search: string;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.debug.companyDomain).toBe("acme.com");
    expect(body.debug.candidateCount).toBe(0);
    expect(body.debug.providerStatus.hunter).toBe("auth_failed");
    expect(body.debug.warnings).toContain("Hunter authentication failed");
  });
});
