"use client";

import ApplicationAssistant from "@/components/ApplicationAssistant";
import AtsScoreCard from "@/components/AtsScoreCard";
import OutreachComposer from "@/components/OutreachComposer";
import RecruiterPanel from "@/components/RecruiterPanel";
import TexDocumentWorkspace from "@/components/TexDocumentWorkspace";
import { useToast } from "@/components/ToastProvider";
import { STATUS_OPTIONS, getStatusClasses, getStatusLabel } from "@/lib/job-status";
import { AtsResult, AtsSuggestion, JobListing } from "@/types";
import clsx from "clsx";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type TabKey = "analyze" | "coverLetter" | "recruiters" | "email" | "assistant";
type AnalyzeView = "score" | "improve";

interface JobsResponse {
  success: boolean;
  data?: JobListing[];
  error?: string;
}

interface AtsResponse {
  success: boolean;
  data?: AtsResult;
  error?: string;
}

interface AtsSuggestionsResponse {
  success: boolean;
  data?: {
    score: number;
    missingKeywords: string[];
    suggestions: AtsSuggestion[];
  };
  error?: string;
}

interface ApplyResumeResponse {
  success: boolean;
  data?: {
    tailoredResume: string;
    fileName?: string;
  };
  error?: string;
}

interface GenerateCoverLetterResponse {
  success: boolean;
  data?: {
    coverLetterText: string;
    fileName?: string;
    usedBaseCoverLetter: boolean;
  };
  error?: string;
}

const SOURCE_STYLES: Record<string, string> = {
  linkedin: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  indeed: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
};

function buildAtsResultFromJob(job: JobListing): AtsResult | null {
  if (job.atsScore === null || job.atsScore === undefined) {
    return null;
  }

  return {
    score: job.atsScore,
    matchedKeywords: [],
    missingKeywords: job.atsKeywordGaps || [],
    suggestions: job.atsSuggestions || [],
    scoreBreakdown: {
      keywordMatch: 0,
      skillsAlignment: 0,
      experienceRelevance: 0,
      formatQuality: 0,
    },
    topMissingSkills: job.atsKeywordGaps || [],
    summary: "ATS score loaded from the latest compiled PDF analysis for this job.",
  };
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  const { toast } = useToast();
  const [job, setJob] = useState<JobListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("analyze");
  const [analyzeView, setAnalyzeView] = useState<AnalyzeView>("score");
  const [statusSaving, setStatusSaving] = useState(false);

  const [atsLoading, setAtsLoading] = useState(false);
  const [atsResult, setAtsResult] = useState<AtsResult | null>(null);
  const [, setSuggestionsLoading] = useState(false);
  const [, setSuggestionsError] = useState<string | null>(null);
  const [, setAtsSuggestions] = useState<AtsSuggestion[]>([]);

  const [resumeDraftLoading, setResumeDraftLoading] = useState(false);
  const [resumeWorkspaceRefreshToken, setResumeWorkspaceRefreshToken] = useState(0);
  const [coverLetterLoading, setCoverLetterLoading] = useState(false);
  const [coverLetterUsedBase, setCoverLetterUsedBase] = useState(false);
  const [coverLetterWorkspaceRefreshToken, setCoverLetterWorkspaceRefreshToken] = useState(0);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [researchToken, setResearchToken] = useState(0);

  const loadJob = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      const data = (await res.json()) as JobsResponse;

      if (!data.success || !data.data) {
        throw new Error(data.error || "Failed to load jobs");
      }

      const found = data.data.find((item) => item.id === jobId) || null;
      setJob(found);
      if (found) {
        setAtsResult(buildAtsResultFromJob(found));
      }
    } catch (error: unknown) {
      setLoadError(error as Error);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const loadAtsSuggestions = useCallback(async () => {
    setSuggestionsLoading(true);
    setSuggestionsError(null);

    try {
      const res = await fetch(`/api/ats?jobId=${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as AtsSuggestionsResponse;

      if (!res.ok || !data.success || !data.data) {
        throw new Error(data.error || "No ATS suggestions available yet");
      }

      const nextSuggestions = Array.isArray(data.data.suggestions) ? data.data.suggestions : [];
      setAtsSuggestions(nextSuggestions);
      setJob((prev) => (prev ? { ...prev, atsSuggestions: nextSuggestions } : prev));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load ATS suggestions";
      setSuggestionsError(message);
      setAtsSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadJob();
    loadAtsSuggestions();
  }, [loadAtsSuggestions, loadJob]);

  const runAts = useCallback(
    async (targetJob: JobListing) => {
      setAtsLoading(true);
      try {
        const res = await fetch("/api/ats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: targetJob.id,
            jobDescription: targetJob.jobDescription,
          }),
        });
        const data = (await res.json()) as AtsResponse;

        if (data.success && data.data) {
          setAtsResult(data.data);
          setJob((prev) =>
            prev
              ? {
                  ...prev,
                  atsScore: data.data!.score,
                  atsKeywordGaps: data.data!.missingKeywords || [],
                  atsSuggestions: data.data!.suggestions || [],
                }
              : prev
          );
          setAtsSuggestions(data.data.suggestions || []);
          setSuggestionsError(null);
          toast("ATS score ready", "success");
        } else {
          toast(data.error || "ATS scoring failed", "error");
        }
      } catch {
        toast("ATS scoring failed", "error");
      } finally {
        setAtsLoading(false);
      }
    },
    [toast]
  );

  const generateResumeDraft = useCallback(async () => {
    if (!job) return;

    setResumeDraftLoading(true);
    try {
      const res = await fetch("/api/resume/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = (await res.json()) as ApplyResumeResponse;

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate job-specific CV draft");
      }

      setResumeWorkspaceRefreshToken((value) => value + 1);
      toast("Job-specific CV draft generated", "success");
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : "Failed to generate job-specific CV draft", "error");
    } finally {
      setResumeDraftLoading(false);
    }
  }, [job, toast]);

  const generateCoverLetter = useCallback(async () => {
    if (!job) return;

    setCoverLetterLoading(true);
    try {
      const res = await fetch("/api/cover-letter/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = (await res.json()) as GenerateCoverLetterResponse;

      if (!res.ok || !data.success || !data.data) {
        throw new Error(data.error || "Failed to generate cover letter");
      }

      setCoverLetterUsedBase(data.data.usedBaseCoverLetter);
      setCoverLetterWorkspaceRefreshToken((value) => value + 1);
      toast("Job-specific cover letter generated", "success");
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : "Failed to generate cover letter", "error");
    } finally {
      setCoverLetterLoading(false);
    }
  }, [job, toast]);

  const saveTemplateCopy = useCallback(
    async (url: string, payload: { texSource: string; fileName: string }, label: string) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { success: boolean; error?: string };
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Failed to save ${label}`);
        }
        toast(`${label} updated`, "success");
      } catch (error: unknown) {
        toast(error instanceof Error ? error.message : `Failed to save ${label}`, "error");
      }
    },
    [toast]
  );

  const handleStatusChange = useCallback(
    async (nextStatus: JobListing["status"]) => {
      if (!job) return;
      setStatusSaving(true);
      try {
        const nextJob = { ...job, status: nextStatus };
        const res = await fetch("/api/jobs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextJob),
        });
        const data = (await res.json()) as { success: boolean; error?: string };
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to update status");
        }
        setJob(nextJob);
        toast("Job status updated", "success");
      } catch (error: unknown) {
        toast(error instanceof Error ? error.message : "Failed to update status", "error");
      } finally {
        setStatusSaving(false);
      }
    },
    [job, toast]
  );

  const hasRecruiter = useMemo(() => {
    if (!job) return false;
    return (
      job.recruiterCandidates.length > 0 ||
      Boolean(job.recruiterName || job.recruiterEmail || job.recruiterProfileUrl)
    );
  }, [job]);

  if (loading) {
    return <main className="p-8 text-sm text-zinc-500">Loading job...</main>;
  }

  if (loadError) {
    throw loadError;
  }

  if (!job) {
    return (
      <main className="p-8">
        <p className="mb-3 text-sm text-zinc-500">Job not found.</p>
        <button
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700"
          onClick={() => router.push("/")}
        >
          Back to Dashboard
        </button>
      </main>
    );
  }

  const hasAtsGuidance = Boolean(job.atsScore !== null || job.atsSuggestions.length || job.atsKeywordGaps.length);

  return (
    <main className="p-4 md:p-7">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => router.push("/")}
          className="text-sm text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          Back to Dashboard
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <section className="space-y-4 xl:col-span-3">
          <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-5 dark:border-zinc-800">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">{job.title}</h1>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{job.company}</p>
              </div>
              <span
                className={clsx(
                  "rounded-full px-2 py-1 text-xs font-medium",
                  SOURCE_STYLES[job.source] || "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                )}
              >
                {job.source}
              </span>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-2 text-sm text-zinc-500 md:grid-cols-2">
              <p>Location: {job.location || "-"}</p>
              <p>Salary: {job.salary || "-"}</p>
              <p>Posted: {new Date(job.postedAt).toLocaleDateString()}</p>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-zinc-500">Status:</span>
                <select
                  value={job.status}
                  onChange={(event) => handleStatusChange(event.target.value as JobListing["status"])}
                  disabled={statusSaving}
                  className={clsx("h-8 rounded-md border px-2 text-xs font-medium", getStatusClasses(job.status))}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {getStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {job.applyUrl && (
              <a
                href={job.applyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Apply Now
              </a>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-5 dark:border-zinc-800">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Job Description</h2>
              <button
                onClick={() => setShowFullDescription((prev) => !prev)}
                className="text-xs text-zinc-500 underline"
              >
                Show {showFullDescription ? "less" : "more"}
              </button>
            </div>

            <div
              className={clsx(
                "overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-zinc-600 dark:text-zinc-300",
                showFullDescription ? "max-h-[520px]" : "max-h-[300px]"
              )}
            >
              {job.jobDescription || "No description available."}
            </div>
          </div>
        </section>

        <section className="space-y-4 xl:col-span-2">
          <div className="grid grid-cols-5 rounded-md border border-zinc-200 bg-[var(--surface)] p-1 dark:border-zinc-800">
            {[
              { key: "analyze", label: "Analyze" },
              { key: "coverLetter", label: "Cover Letter" },
              { key: "recruiters", label: "Recruiters" },
              { key: "email", label: "Cold Email" },
              { key: "assistant", label: "Apply Assistant" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabKey)}
                className={clsx(
                  "rounded px-2 py-2 text-[11px] font-medium",
                  activeTab === tab.key
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-500"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "analyze" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 rounded-md border border-zinc-200 bg-[var(--surface)] p-1 dark:border-zinc-800">
                {(["score", "improve"] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => setAnalyzeView(view)}
                    className={clsx(
                      "rounded px-2 py-1.5 text-xs font-medium capitalize",
                      analyzeView === view
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-500"
                    )}
                  >
                    {view === "score" ? "Score" : "Improve"}
                  </button>
                ))}
              </div>

              {analyzeView === "score" && (
                <div className="space-y-3">
                  <button
                    onClick={() => runAts(job)}
                    disabled={atsLoading}
                    className="h-9 rounded-md border border-zinc-200 px-3 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {atsLoading ? "Analyzing..." : "Re-analyze"}
                  </button>
                  <AtsScoreCard result={atsResult} loading={atsLoading} />
                </div>
              )}

              {analyzeView === "improve" && (
                <div className="space-y-4">
                  {!hasAtsGuidance ? (
                    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                      Run ATS Score first. The improvement guidance is based on the text extracted from the compiled PDF version of your resume.
                    </div>
                  ) : (
                    <>
                      <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-4 dark:border-zinc-800">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold">ATS Guidance</h3>
                            <p className="text-xs text-zinc-500">
                              These recommendations are derived from the compiled PDF text. Review them as guidance before regenerating or editing the job-specific CV.
                            </p>
                          </div>
                          <button
                            onClick={generateResumeDraft}
                            disabled={resumeDraftLoading}
                            className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                          >
                            {resumeDraftLoading ? "Generating..." : "Generate Job CV Draft"}
                          </button>
                        </div>

                        <div className="space-y-2">
                          {job.atsSuggestions.map((suggestion, index) => (
                            <div
                              key={`${suggestion.section}_${index}`}
                              className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-3 text-xs dark:border-zinc-800"
                            >
                              <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                  {suggestion.section}
                                </span>
                                {suggestion.keywordsAdded?.map((keyword) => (
                                  <span
                                    key={keyword}
                                    className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                                  >
                                    +{keyword}
                                  </span>
                                ))}
                              </div>
                              {suggestion.original ? (
                                <p className="mb-1 text-zinc-400 line-through dark:text-zinc-600">{suggestion.original}</p>
                              ) : null}
                              <p className="text-zinc-800 dark:text-zinc-200">{suggestion.suggested}</p>
                              <p className="mt-1 text-zinc-500 italic">{suggestion.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <TexDocumentWorkspace
                        title="Job-Specific CV"
                        description="This draft is scoped to this job. Edit the TeX, save it, and the PDF preview will refresh from the saved version."
                        documentLabel="Job CV"
                        fetchUrl="/api/resume"
                        saveUrl="/api/resume"
                        compileUrl="/api/resume/compile"
                        queryJobId={job.id}
                        fileNameFallback={`${job.company}-${job.title}-resume.tex`}
                        saveLabel="Save Job CV Draft"
                        refreshToken={resumeWorkspaceRefreshToken}
                        actions={({ texSource, fileName, loading: workspaceLoading }) => (
                          <button
                            type="button"
                            disabled={workspaceLoading || !texSource.trim()}
                            onClick={() =>
                              saveTemplateCopy(
                                "/api/resume",
                                { texSource, fileName: fileName || `${job.company}-${job.title}-resume.tex` },
                                "Base resume template"
                              )
                            }
                            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                          >
                            Save as Base Template
                          </button>
                        )}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "coverLetter" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-4 dark:border-zinc-800">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Generate Job Cover Letter</h3>
                    <p className="text-xs text-zinc-500">
                      {coverLetterUsedBase
                        ? "The last generated draft reused your saved base cover letter template."
                        : "Generate a job-specific cover letter from your base template or a default letter layout."}
                    </p>
                  </div>
                  <button
                    onClick={generateCoverLetter}
                    disabled={coverLetterLoading}
                    className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {coverLetterLoading ? "Generating..." : "Generate for this Job"}
                  </button>
                </div>
              </div>

              <TexDocumentWorkspace
                title="Job-Specific Cover Letter"
                description="Edit this cover letter before saving and compiling. The PDF preview always reflects the latest saved job-specific draft."
                documentLabel="Cover Letter"
                fetchUrl="/api/cover-letter"
                saveUrl="/api/cover-letter"
                compileUrl="/api/cover-letter/compile"
                queryJobId={job.id}
                fileNameFallback={`${job.company}-${job.title}-cover-letter.tex`}
                saveLabel="Save Job Cover Letter"
                refreshToken={coverLetterWorkspaceRefreshToken}
                actions={({ texSource, fileName, loading: workspaceLoading }) => (
                  <button
                    type="button"
                    disabled={workspaceLoading || !texSource.trim()}
                    onClick={() =>
                      saveTemplateCopy(
                        "/api/cover-letter",
                        { texSource, fileName: fileName || `${job.company}-${job.title}-cover-letter.tex` },
                        "Base cover letter template"
                      )
                    }
                    className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                  >
                    Save as Base Template
                  </button>
                )}
              />
            </div>
          )}

          {activeTab === "recruiters" && (
            <div className="space-y-3">
              <button
                onClick={() => setResearchToken((value) => value + 1)}
                className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Research Recruiters
              </button>
              <RecruiterPanel
                job={job}
                hideHeaderButton
                autoResearchToken={researchToken}
                onRefresh={loadJob}
              />
            </div>
          )}

          {activeTab === "email" && (
            <div>
              {!hasRecruiter ? (
                <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-4 text-sm text-zinc-500 dark:border-zinc-800">
                  No recruiter found yet. Go to the Recruiters tab and run &quot;Research Recruiters&quot; first.
                </div>
              ) : (
                <OutreachComposer job={job} onRefresh={loadJob} />
              )}
            </div>
          )}

          {activeTab === "assistant" && (
            <ApplicationAssistant
              jobId={job.id}
              jobTitle={job.title}
              company={job.company}
              jobDescription={job.jobDescription}
            />
          )}
        </section>
      </div>
    </main>
  );
}
