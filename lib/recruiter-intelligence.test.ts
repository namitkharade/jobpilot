import { describe, expect, it } from "vitest";

import { normalizeRecruiterCandidate, normalizeResearchEvidence } from "./job-normalize";
import { recruiterIntelligenceTestUtils } from "./recruiter-intelligence";

const targetProfile = {
  discipline: "engineering",
  department: "engineering",
  targetTitles: ["engineering manager", "technical recruiter"],
  seniorityHint: "",
  keywords: ["platform", "backend", "typescript"],
  locationHint: "",
  roleFamily: "software engineering",
};

describe("recruiter intelligence helpers", () => {
  it("filters job-board apply hosts and keeps first-party company domains", () => {
    expect(
      recruiterIntelligenceTestUtils.parseCompanyDomainFromApplyUrl("https://boards.greenhouse.io/acme/jobs/123")
    ).toBe("");
    expect(
      recruiterIntelligenceTestUtils.parseCompanyDomainFromApplyUrl("https://careers.acme.com/jobs/backend-engineer")
    ).toBe("careers.acme.com");
  });

  it("dedupes candidates while preserving stronger verification and evidence", () => {
    const first = normalizeRecruiterCandidate({
      id: "cand_1",
      name: "Ava Recruiter",
      title: "Technical Recruiter",
      linkedinUrl: "https://www.linkedin.com/in/ava/",
      email: "",
      emailVerificationStatus: "not_found",
      emailConfidence: 0,
      domainPattern: "",
      sourceTypes: ["hunter"],
      sourceSummary: "Hunter search",
      evidence: [
        normalizeResearchEvidence({
          sourceType: "hunter",
          url: "https://acme.com/team",
          title: "Team page",
          snippet: "Ava leads technical recruiting.",
          domain: "acme.com",
        }),
      ],
    });

    const second = normalizeRecruiterCandidate({
      id: "cand_2",
      name: "Ava Recruiter",
      title: "Technical Recruiter",
      linkedinUrl: "https://www.linkedin.com/in/ava/",
      email: "ava@acme.com",
      emailVerificationStatus: "valid",
      emailConfidence: 95,
      domainPattern: "{first}.{last}",
      sourceTypes: ["apply-url"],
      sourceSummary: "Apply page signal",
      evidence: [
        normalizeResearchEvidence({
          sourceType: "apply-url",
          url: "https://careers.acme.com/backend",
          title: "Apply page",
          snippet: "Reach out to Ava for role questions.",
          domain: "careers.acme.com",
        }),
      ],
    });

    const deduped = recruiterIntelligenceTestUtils.dedupeCandidates([first, second]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].email).toBe("ava@acme.com");
    expect(deduped[0].emailVerificationStatus).toBe("valid");
    expect(deduped[0].evidence).toHaveLength(2);
    expect(deduped[0].sourceTypes).toEqual(expect.arrayContaining(["hunter", "apply-url"]));
  });

  it("scores recruiter candidates deterministically", () => {
    const candidate = normalizeRecruiterCandidate({
      name: "Ava Recruiter",
      title: "Technical Recruiter",
      linkedinUrl: "https://www.linkedin.com/in/ava/",
      email: "ava@acme.com",
      emailVerificationStatus: "valid",
      emailConfidence: 97,
      domainPattern: "{first}.{last}",
      sourceTypes: ["job-poster", "hunter"],
      sourceSummary: "Backend platform recruiting",
      evidence: [
        normalizeResearchEvidence({
          sourceType: "job-poster",
          url: "https://careers.acme.com/backend",
          title: "Backend job posting",
          snippet: "Platform and TypeScript work",
          domain: "careers.acme.com",
          extractedOn: new Date().toISOString(),
          lastSeenOn: new Date().toISOString(),
          stillOnPage: true,
        }),
      ],
    });

    const scored = recruiterIntelligenceTestUtils.scoreCandidate(candidate, targetProfile);
    expect(scored.score).toBeGreaterThanOrEqual(70);
    expect(scored.reasons).toEqual(expect.arrayContaining(["Verified email available", "First-party poster/apply-page signal"]));
  });
});
