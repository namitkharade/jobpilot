import { describe, expect, it } from "vitest";

import { extractLinkedInHandle, normalizeJobListing } from "./job-normalize";

describe("job normalization", () => {
  it("lazily migrates legacy recruiter fields into a recruiter candidate", () => {
    const job = normalizeJobListing({
      id: "job_legacy",
      title: "Backend Engineer",
      company: "Acme",
      postedAt: "2026-04-01T00:00:00.000Z",
      scrapedAt: "2026-04-01T00:00:00.000Z",
      recruiterName: "Ava Recruiter",
      recruiterTitle: "Talent Acquisition Partner",
      recruiterEmail: "ava@acme.com",
      recruiterProfileUrl: "https://www.linkedin.com/in/ava-recruiter/",
    });

    expect(job.recruiterCandidates).toHaveLength(1);
    expect(job.selectedRecruiterId).toBe(job.recruiterCandidates[0].id);
    expect(job.recruiterCandidates[0].sourceTypes).toEqual(["legacy"]);
    expect(job.recruiterCandidates[0].email).toBe("ava@acme.com");
    expect(job.recruiterName).toBe("Ava Recruiter");
    expect(job.recruiterEmail).toBe("ava@acme.com");
  });

  it("extracts linkedin handles from profile urls", () => {
    expect(extractLinkedInHandle("https://www.linkedin.com/in/ava-recruiter/")).toBe("ava-recruiter");
    expect(extractLinkedInHandle("https://www.linkedin.com/company/openai/")).toBe("");
  });
});
