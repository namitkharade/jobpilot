import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import OutreachComposer from "@/components/OutreachComposer";
import { ToastProvider } from "@/components/ToastProvider";
import { normalizeJobListing, normalizeRecruiterCandidate } from "@/lib/job-normalize";

describe("OutreachComposer", () => {
  it("shows the blocked-state guidance when no channel is available", () => {
    const blockedCandidate = normalizeRecruiterCandidate({
      id: "candidate_blocked",
      name: "Blocked Contact",
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
      id: "job_blocked_ui",
      title: "Backend Engineer",
      company: "Acme",
      jobDescription: "Own backend platform and TypeScript services.",
      postedAt: "2026-04-01T00:00:00.000Z",
      scrapedAt: "2026-04-01T00:00:00.000Z",
      recruiterCandidates: [blockedCandidate],
      selectedRecruiterId: blockedCandidate.id,
    });

    render(
      <ToastProvider>
        <OutreachComposer job={job} />
      </ToastProvider>
    );

    expect(
      screen.getByText(/does not have a verified email or LinkedIn profile yet/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open linkedin search/i })).toBeInTheDocument();
  });
});
