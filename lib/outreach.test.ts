import { describe, expect, it } from "vitest";

import { normalizeJobListing, normalizeRecruiterCandidate } from "./job-normalize";
import { buildOutreachSentUpdate, generateOutreach } from "./outreach";

function buildBaseJob() {
  const candidate = normalizeRecruiterCandidate({
    id: "candidate_1",
    name: "Ava Recruiter",
    title: "Technical Recruiter",
    linkedinUrl: "https://www.linkedin.com/in/ava/",
    email: "ava@acme.com",
    emailVerificationStatus: "valid",
    emailConfidence: 98,
    domainPattern: "{first}.{last}",
    sourceTypes: ["hunter"],
    sourceSummary: "Hunter search",
    evidence: [],
  });

  return normalizeJobListing({
    id: "job_outreach",
    title: "Backend Engineer",
    company: "Acme",
    jobDescription: "Own backend platform and TypeScript services.",
    postedAt: "2026-04-01T00:00:00.000Z",
    scrapedAt: "2026-04-01T00:00:00.000Z",
    recruiterCandidates: [candidate],
    selectedRecruiterId: candidate.id,
    outreach: {
      status: "drafted",
      preferredChannel: "email",
      selectedDraftId: "draft_1",
      drafts: [
        {
          id: "draft_1",
          candidateId: candidate.id,
          channel: "email",
          tone: "professional",
          subject: "Backend Engineer at Acme",
          body: "A short grounded outreach draft.",
          wordCount: 5,
          hookType: "role-observation",
          cta: "Would you be open to a short chat next week?",
          groundingUrls: [],
          generatedAt: "2026-04-01T00:00:00.000Z",
          sentAt: null,
        },
      ],
      brief: null,
      lastResearchedAt: "2026-04-01T00:00:00.000Z",
      lastDraftedAt: "2026-04-01T00:00:00.000Z",
      lastSentAt: "",
    },
  });
}

describe("outreach state", () => {
  it("marking a draft as sent updates outreach state without mutating job status", () => {
    const job = buildBaseJob();
    const updates = buildOutreachSentUpdate(job, "draft_1");

    expect(job.status).toBe("saved");
    expect(updates).not.toHaveProperty("status");
    expect(updates.outreach?.status).toBe("sent");
    expect(updates.outreach?.selectedDraftId).toBe("draft_1");
    expect(updates.outreach?.drafts[0].sentAt).toBeTruthy();
  });

  it("blocks outreach when the selected candidate has no usable channel", async () => {
    const blockedCandidate = normalizeRecruiterCandidate({
      id: "candidate_blocked",
      name: "Unknown Contact",
      title: "Hiring Team",
      linkedinUrl: "",
      email: "",
      emailVerificationStatus: "not_found",
      emailConfidence: 0,
      domainPattern: "",
      sourceTypes: ["manual"],
      sourceSummary: "Manual placeholder",
      evidence: [],
    });

    const job = normalizeJobListing({
      id: "job_blocked",
      title: "Backend Engineer",
      company: "Acme",
      jobDescription: "Own backend platform and TypeScript services.",
      postedAt: "2026-04-01T00:00:00.000Z",
      scrapedAt: "2026-04-01T00:00:00.000Z",
      recruiterCandidates: [blockedCandidate],
      selectedRecruiterId: blockedCandidate.id,
    });

    const result = await generateOutreach(job);
    expect(result.response.preferredChannel).toBe("blocked");
    expect(result.response.drafts).toEqual([]);
    expect(result.updates.outreach?.status).toBe("blocked");
  });
});
