import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("jobs db", () => {
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-jobs-db-"));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("round-trips imported metadata and manual sources through local storage", async () => {
    const jobsDb = await import("./jobs-db");

    await jobsDb.appendJobsToDb([
      {
        id: "job_manual_import",
        title: "Platform Engineer",
        company: "Northstar",
        location: "Remote",
        salary: "",
        jobType: "Full-time",
        postedAt: "2026-04-02T00:00:00.000Z",
        scrapedAt: "2026-04-02T01:00:00.000Z",
        applyUrl: "https://jobs.northstar.dev/platform-engineer",
        jobDescription: "Build platform services.",
        companyDescription: "Northstar builds developer tooling.",
        atsScore: null,
        atsKeywordGaps: [],
        atsSuggestions: [],
        status: "saved",
        recruiterName: "",
        recruiterTitle: "",
        recruiterProfileUrl: "",
        recruiterEmail: "",
        emailDraft: "",
        jobPosterName: "Avery Quinn",
        jobPosterTitle: "Senior Recruiter",
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
        source: "manual",
      },
    ]);

    const jobs = await jobsDb.getAllJobsFromDb();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.source).toBe("manual");
    expect(jobs[0]?.postedAt).toBe("2026-04-02T00:00:00.000Z");
    expect(jobs[0]?.companyDescription).toBe("Northstar builds developer tooling.");
    expect(jobs[0]?.jobPosterName).toBe("Avery Quinn");
    expect(jobs[0]?.jobPosterTitle).toBe("Senior Recruiter");
  });
});
