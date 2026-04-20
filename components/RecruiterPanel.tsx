"use client";

import { useToast } from "@/components/ToastProvider";
import { JobListing, RecruiterCandidate, RecruiterResearchResult } from "@/types";
import { ReactNode, useEffect, useMemo, useState } from "react";

interface RecruiterPanelProps {
  job: JobListing;
  autoResearchToken?: number;
  hideHeaderButton?: boolean;
  onRefresh?: () => Promise<void> | void;
}

const LOADING_STEPS = [
  "Mapping the role to likely hiring owners...",
  "Searching first-party and company signals...",
  "Scoring recruiter and manager candidates...",
  "Enriching the best contacts for outreach...",
];

function hasFreshEvidence(candidate: RecruiterCandidate) {
  return candidate.evidence.some((entry) => {
    const lastSeen = entry.lastSeenOn || entry.extractedOn;
    if (!lastSeen) return false;
    const timestamp = new Date(lastSeen).getTime();
    if (Number.isNaN(timestamp)) return false;
    return Date.now() - timestamp <= 365 * 24 * 60 * 60 * 1000;
  });
}

function buildManualSearchUrl(job: JobListing, candidates: RecruiterCandidate[]) {
  const titles = candidates.slice(0, 3).map((candidate) => candidate.title).filter(Boolean);
  const query = `${job.company} ${titles.join(" OR ") || job.title} LinkedIn`;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
}

function getPreferredChannel(candidate: RecruiterCandidate | null) {
  if (!candidate) return "blocked" as const;
  if (
    candidate.email &&
    (candidate.emailVerificationStatus === "valid" || candidate.emailVerificationStatus === "accept_all")
  ) {
    return "email" as const;
  }
  if (candidate.linkedinUrl) {
    return "linkedin" as const;
  }
  return "blocked" as const;
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
      {children}
    </span>
  );
}

export default function RecruiterPanel({
  job,
  autoResearchToken,
  hideHeaderButton,
  onRefresh,
}: RecruiterPanelProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [refreshingCandidateId, setRefreshingCandidateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const manualSearchUrl = useMemo(
    () => buildManualSearchUrl(job, job.recruiterCandidates),
    [job]
  );

  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setLoadingStep((step) => Math.min(step + 1, LOADING_STEPS.length - 1));
    }, 2200);
    return () => clearInterval(interval);
  }, [loading]);

  const handleResearch = async (candidateId?: string) => {
    if (!job.jobDescription.trim()) {
      setError("Please provide a job description before researching contacts.");
      return;
    }

    setLoading(true);
    setLoadingStep(0);
    setError(null);
    setRefreshingCandidateId(candidateId || null);

    try {
      const res = await fetch("/api/recruiter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          company: job.company,
          role: job.title,
          jobDescription: job.jobDescription,
          applyUrl: job.applyUrl,
          companyDescription: job.companyDescription,
          forceRefresh: true,
          candidateId,
        }),
      });

      const response = (await res.json()) as { success: boolean; data?: RecruiterResearchResult; error?: string };
      if (!res.ok || !response.success || !response.data) {
        throw new Error(response.error || "Failed to research recruiter contacts");
      }

      await onRefresh?.();
      const primaryMessage = candidateId
        ? "Contact refreshed"
        : `Found ${response.data.candidates.length} contact candidates`;
      toast(primaryMessage, "success");
      if (response.data.warnings.length > 0) {
        toast(response.data.warnings[0], response.data.candidates.length > 0 ? "info" : "error");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to research recruiter contacts";
      setError(message);
      toast(message, "error");
    } finally {
      setLoading(false);
      setRefreshingCandidateId(null);
    }
  };

  const handleSelectCandidate = async (candidateId: string) => {
    const selected = job.recruiterCandidates.find((candidate) => candidate.id === candidateId) || null;
    if (!selected) return;

    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: job.id,
          selectedRecruiterId: candidateId,
          outreach: {
            ...job.outreach,
            status: job.outreach.status === "sent" ? "sent" : "researched",
            preferredChannel: getPreferredChannel(selected),
          },
        }),
      });

      const body = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !body.success) {
        throw new Error(body.error || "Failed to select contact");
      }

      await onRefresh?.();
      toast("Selected contact updated", "success");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to select contact", "error");
    }
  };

  useEffect(() => {
    if (autoResearchToken && autoResearchToken > 0) {
      void handleResearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResearchToken]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-[var(--surface)] shadow-sm dark:border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50/80 p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Contact Intelligence</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            First-party signals, Hunter enrichment, and grounded fallback research for recruiter outreach.
          </p>
        </div>
        {!hideHeaderButton && (
          <button
            onClick={() => handleResearch()}
            disabled={loading}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {loading ? "Researching..." : job.recruiterCandidates.length ? "Refresh Research" : "Research Contacts"}
          </button>
        )}
      </div>

      <div className="space-y-5 p-5">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Domain: {job.companyDomain || "Pending"}</Badge>
            <Badge>Contacts: {job.recruiterCandidates.length}</Badge>
            <Badge>Research: {job.outreach.lastResearchedAt ? new Date(job.outreach.lastResearchedAt).toLocaleDateString() : "Not run yet"}</Badge>
          </div>
          {job.companyIntel?.description && (
            <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{job.companyIntel.description}</p>
          )}
          {!!job.companyIntel?.signals?.length && (
            <div className="mt-3 space-y-2">
              {job.companyIntel.signals.slice(0, 3).map((signal) => (
                <a
                  key={`${signal.url}-${signal.title}`}
                  href={signal.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-600 transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300 dark:hover:border-zinc-700"
                >
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{signal.title || signal.url}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{signal.snippet}</div>
                </a>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{LOADING_STEPS[loadingStep]}</p>
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="mb-3 h-4 w-44 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="mb-2 h-3 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            {error}
          </div>
        ) : job.recruiterCandidates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No candidates have been persisted for this job yet.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => handleResearch()}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Research Contacts
              </button>
              <a
                href={manualSearchUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Manual LinkedIn Search
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {job.recruiterCandidates.map((candidate) => {
              const isSelected = candidate.id === job.selectedRecruiterId;
              const canRefresh = !candidate.email || candidate.emailVerificationStatus === "unknown" || candidate.emailVerificationStatus === "unverified";
              return (
                <div
                  key={candidate.id}
                  className={`rounded-xl border p-5 transition ${
                    isSelected
                      ? "border-zinc-900 bg-zinc-50 dark:border-zinc-200 dark:bg-zinc-900/80"
                      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/30"
                  }`}
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{candidate.name || "Unknown contact"}</h3>
                        {isSelected && <Badge>Selected</Badge>}
                        <Badge>Score {candidate.score}</Badge>
                      </div>
                      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{candidate.title || "Title unavailable"}</p>
                      <div className="flex flex-wrap gap-2">
                        {candidate.emailVerificationStatus === "valid" && <Badge>Verified email</Badge>}
                        {candidate.emailVerificationStatus === "accept_all" && <Badge>Accept-all email</Badge>}
                        {!candidate.email && candidate.linkedinUrl && <Badge>LinkedIn only</Badge>}
                        {candidate.sourceTypes.includes("job-poster") || candidate.sourceTypes.includes("apply-url") ? <Badge>First-party poster</Badge> : null}
                        {hasFreshEvidence(candidate) ? <Badge>Fresh evidence</Badge> : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {candidate.linkedinUrl && (
                        <a
                          href={candidate.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Open LinkedIn
                        </a>
                      )}
                      {canRefresh && (
                        <button
                          onClick={() => handleResearch(candidate.id)}
                          disabled={loading}
                          className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          {refreshingCandidateId === candidate.id && loading ? "Refreshing..." : "Refresh Contact"}
                        </button>
                      )}
                      <button
                        onClick={() => handleSelectCandidate(candidate.id)}
                        disabled={isSelected}
                        className="rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                      >
                        {isSelected ? "Selected" : "Select Contact"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                    <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Best channel</div>
                    <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                      {getPreferredChannel(candidate) === "email"
                        ? candidate.email
                        : getPreferredChannel(candidate) === "linkedin"
                          ? "LinkedIn message"
                          : "Blocked until a usable contact method is found"}
                    </div>
                  </div>

                  {!!candidate.reasons.length && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {candidate.reasons.slice(0, 4).map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  )}

                  {!!candidate.evidence.length && (
                    <div className="mt-4 space-y-2">
                      {candidate.evidence.slice(0, 2).map((evidence) => (
                        <a
                          key={`${candidate.id}-${evidence.url}-${evidence.title}`}
                          href={evidence.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block rounded-lg border border-zinc-200 bg-white p-3 text-sm hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950/40 dark:hover:border-zinc-700"
                        >
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">{evidence.title || evidence.url}</div>
                          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{evidence.snippet || evidence.domain}</div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
