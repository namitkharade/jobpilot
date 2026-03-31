"use client";

import ApplicationAssistant from "@/components/ApplicationAssistant";
import AtsScoreCard from "@/components/AtsScoreCard";
import EmailDrafter from "@/components/EmailDrafter";
import RecruiterPanel from "@/components/RecruiterPanel";
import { useToast } from "@/components/ToastProvider";
import { STATUS_OPTIONS, getStatusClasses, getStatusLabel } from "@/lib/job-status";
import { AtsResult, AtsSuggestion, JobListing, RecruiterProfile } from "@/types";
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

interface ResumeStatusResponse {
  success: boolean;
  data?: {
    text: string;
  };
  error?: string;
}

interface ApplyResumeResponse {
  success: boolean;
  data?: {
    tailoredResume: string;
  };
  error?: string;
}

interface CoverLetterResponse {
  success: boolean;
  data?: {
    loaded: boolean;
    characterCount: number;
    text: string;
    updatedAt: string | null;
    tailoredText?: string | null;
  };
  error?: string;
}

interface GenerateCoverLetterResponse {
  success: boolean;
  data?: {
    coverLetterText: string;
    usedBaseCoverLetter: boolean;
  };
  error?: string;
}

interface CompileResumeResponse {
  success: boolean;
  pdfBase64?: string;
  error?: string;
}

const buildPdfBlob = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "application/pdf" });
};

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
    summary: "ATS score loaded from your saved job data.",
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

  const [applyingChanges, setApplyingChanges] = useState(false);
  const [applyingSingleIndex, setApplyingSingleIndex] = useState<number | null>(null);
  const [tailoredResume, setTailoredResume] = useState<string | null>(null);
  const [showTailoredModal, setShowTailoredModal] = useState(false);
  const [tailoredPdfBase64, setTailoredPdfBase64] = useState<string | null>(null);
  const [tailoredPdfLoading, setTailoredPdfLoading] = useState(false);
  const [tailoredPdfError, setTailoredPdfError] = useState<string | null>(null);
  const [tailoredPdfUrl, setTailoredPdfUrl] = useState<string | null>(null);

  const [resumeSummary, setResumeSummary] = useState("");
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [researchToken, setResearchToken] = useState(0);
  const [profiles, setProfiles] = useState<RecruiterProfile[]>([]);

  const [coverLetterText, setCoverLetterText] = useState("");
  const [coverLetterLoading, setCoverLetterLoading] = useState(false);
  const [coverLetterSaving, setCoverLetterSaving] = useState(false);
  const [coverLetterUsedBase, setCoverLetterUsedBase] = useState(false);
  const [coverLetterPdfBase64, setCoverLetterPdfBase64] = useState<string | null>(null);
  const [coverLetterPdfLoading, setCoverLetterPdfLoading] = useState(false);
  const [coverLetterPdfError, setCoverLetterPdfError] = useState<string | null>(null);
  const [coverLetterPdfUrl, setCoverLetterPdfUrl] = useState<string | null>(null);

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

  useEffect(() => {
    fetch("/api/resume/status", { cache: "no-store" })
      .then((res) => res.json() as Promise<ResumeStatusResponse>)
      .then((body) => {
        if (body.success && body.data?.text) {
          setResumeSummary((body.data.text as string).slice(0, 8000));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!job) return;

    fetch(`/api/cover-letter?jobId=${encodeURIComponent(job.id)}`, { cache: "no-store" })
      .then((res) => res.json() as Promise<CoverLetterResponse>)
      .then((body) => {
        if (body.success && body.data) {
          setCoverLetterText(body.data.tailoredText || body.data.text || "");
          setCoverLetterUsedBase(Boolean(body.data.text?.trim()));
        }
      })
      .catch(() => {});
  }, [job]);

  const tailoredPdfBlob = useMemo(() => {
    if (!tailoredPdfBase64) return null;
    return buildPdfBlob(tailoredPdfBase64);
  }, [tailoredPdfBase64]);

  useEffect(() => {
    if (!tailoredPdfBlob) {
      setTailoredPdfUrl(null);
      return;
    }

    const url = URL.createObjectURL(tailoredPdfBlob);
    setTailoredPdfUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [tailoredPdfBlob]);

  useEffect(() => {
    if (!showTailoredModal) {
      setTailoredPdfBase64(null);
      setTailoredPdfError(null);
    }
  }, [showTailoredModal]);

  const coverLetterPdfBlob = useMemo(() => {
    if (!coverLetterPdfBase64) return null;
    return buildPdfBlob(coverLetterPdfBase64);
  }, [coverLetterPdfBase64]);

  useEffect(() => {
    if (!coverLetterPdfBlob) {
      setCoverLetterPdfUrl(null);
      return;
    }

    const url = URL.createObjectURL(coverLetterPdfBlob);
    setCoverLetterPdfUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [coverLetterPdfBlob]);

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
            prev ? { ...prev, atsScore: data.data!.score, atsSuggestions: data.data!.suggestions || [] } : prev
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

  const compileTailoredPdf = useCallback(async () => {
    if (!job) return;
    setTailoredPdfLoading(true);
    setTailoredPdfError(null);

    try {
      const res = await fetch("/api/resume/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = (await res.json()) as CompileResumeResponse;

      if (!res.ok || !data.success || !data.pdfBase64) {
        throw new Error(data.error || "Compilation failed");
      }

      setTailoredPdfBase64(data.pdfBase64);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Compilation failed";
      setTailoredPdfError(message);
      setTailoredPdfBase64(null);
    } finally {
      setTailoredPdfLoading(false);
    }
  }, [job]);

  const downloadPdf = (base64: string, filePrefix = "resume-tailored") => {
    const blob = buildPdfBlob(base64);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileName = `${filePrefix}-${job?.company ?? "company"}-${job?.title ?? "role"}.pdf`.replace(
      /\s+/g,
      "-"
    );
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleApplyChanges = useCallback(async (suggestionIndex?: number) => {
    if (!job) return;
    if (typeof suggestionIndex === "number") {
      setApplyingSingleIndex(suggestionIndex);
    } else {
      setApplyingChanges(true);
    }
    try {
      const res = await fetch("/api/resume/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          typeof suggestionIndex === "number"
            ? { jobId: job.id, suggestionIndex }
            : { jobId: job.id }
        ),
      });
      const data = (await res.json()) as ApplyResumeResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to apply changes");
      }
      setTailoredResume(data.data?.tailoredResume ?? null);
      toast(
        typeof suggestionIndex === "number"
          ? "Suggestion applied and saved"
          : "Tailored resume saved for this job",
        "success"
      );
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to apply changes", "error");
    } finally {
      if (typeof suggestionIndex === "number") {
        setApplyingSingleIndex(null);
      } else {
        setApplyingChanges(false);
      }
    }
  }, [job, toast]);

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

      setCoverLetterText(data.data.coverLetterText);
      setCoverLetterUsedBase(data.data.usedBaseCoverLetter);
      setCoverLetterPdfBase64(null);
      setCoverLetterPdfError(null);
      toast("Cover letter generated", "success");
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : "Failed to generate cover letter", "error");
    } finally {
      setCoverLetterLoading(false);
    }
  }, [job, toast]);

  const saveCoverLetter = useCallback(async () => {
    if (!coverLetterText.trim()) {
      toast("Cover letter is empty", "info");
      return;
    }

    setCoverLetterSaving(true);
    try {
      const res = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverLetterText }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save cover letter");
      }
      toast("Base cover letter updated", "success");
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : "Failed to save cover letter", "error");
    } finally {
      setCoverLetterSaving(false);
    }
  }, [coverLetterText, toast]);

  const compileCoverLetterPdf = useCallback(async () => {
    setCoverLetterPdfLoading(true);
    setCoverLetterPdfError(null);
    try {
      const res = await fetch("/api/cover-letter/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverLetterText }),
      });
      const data = (await res.json()) as CompileResumeResponse;
      if (!res.ok || !data.success || !data.pdfBase64) {
        throw new Error(data.error || "Compilation failed");
      }
      setCoverLetterPdfBase64(data.pdfBase64);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Compilation failed";
      setCoverLetterPdfError(message);
      setCoverLetterPdfBase64(null);
    } finally {
      setCoverLetterPdfLoading(false);
    }
  }, [coverLetterText]);

  const hasRecruiter = useMemo(() => {
    if (!job) return false;
    if (profiles.length > 0) return true;
    return Boolean(job.recruiterName || job.recruiterEmail || job.recruiterProfileUrl);
  }, [job, profiles]);

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
                  onChange={(e) => handleStatusChange(e.target.value as JobListing["status"])}
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
                <div className="space-y-3">
                  {!job.atsSuggestions || job.atsSuggestions.length === 0 ? (
                    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                      No suggestions yet. Run the ATS Score analysis first.
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => handleApplyChanges()}
                        disabled={applyingChanges}
                        className="h-9 w-full rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                      >
                        {applyingChanges ? "Applying..." : "Apply All Changes"}
                      </button>

                      {tailoredResume && (
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/30">
                          <p className="font-medium text-emerald-800 dark:text-emerald-400">
                            Tailored resume saved for this job.
                          </p>
                          <button
                            onClick={() => setShowTailoredModal(true)}
                            className="mt-1 text-xs text-emerald-700 underline dark:text-emerald-400"
                          >
                            View Tailored Resume
                          </button>
                        </div>
                      )}

                      <div className="space-y-2">
                        {job.atsSuggestions.map((suggestion, index) => (
                          <div
                            key={index}
                            className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-3 text-xs dark:border-zinc-800"
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                {suggestion.section}
                              </span>
                              {suggestion.keywordsAdded?.map((kw) => (
                                <span
                                  key={kw}
                                  className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-400"
                                >
                                  +{kw}
                                </span>
                              ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleApplyChanges(index)}
                                disabled={applyingSingleIndex === index}
                                className="inline-flex h-6 w-6 items-center justify-center rounded border border-zinc-200 text-[10px] text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                aria-label="Apply this suggestion"
                                title="Apply this suggestion"
                              >
                                {applyingSingleIndex === index ? "..." : ">"}
                              </button>
                            </div>
                            <p className="mb-1 text-zinc-400 line-through dark:text-zinc-600">
                              {suggestion.original}
                            </p>
                            <p className="text-zinc-800 dark:text-zinc-200">
                              {suggestion.suggested}
                            </p>
                            <p className="mt-1 text-zinc-500 italic">{suggestion.reason}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "coverLetter" && (
            <div className="space-y-3 rounded-lg border border-zinc-200 bg-[var(--surface)] p-4 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={generateCoverLetter}
                  disabled={coverLetterLoading}
                  className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {coverLetterLoading ? "Generating..." : "Generate for this Job"}
                </button>
                <button
                  onClick={saveCoverLetter}
                  disabled={coverLetterSaving || !coverLetterText.trim()}
                  className="h-9 rounded-md border border-zinc-200 px-3 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {coverLetterSaving ? "Saving..." : "Save as Base"}
                </button>
                <button
                  onClick={compileCoverLetterPdf}
                  disabled={coverLetterPdfLoading || !coverLetterText.trim()}
                  className="h-9 rounded-md border border-zinc-200 px-3 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {coverLetterPdfLoading ? "Compiling..." : "Generate PDF"}
                </button>
                {coverLetterPdfBase64 && (
                  <button
                    onClick={() => downloadPdf(coverLetterPdfBase64, "cover-letter")}
                    className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    Download PDF
                  </button>
                )}
              </div>

              <p className="text-xs text-zinc-500">
                {coverLetterUsedBase
                  ? "Generation uses your saved base cover letter when available."
                  : "No base cover letter found; generation starts from scratch."}
              </p>

              <textarea
                value={coverLetterText}
                onChange={(event) => setCoverLetterText(event.target.value)}
                placeholder="Generate or write a cover letter for this job"
                className="min-h-[280px] w-full rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />

              {coverLetterPdfError && <p className="text-xs text-rose-600">{coverLetterPdfError}</p>}

              {coverLetterPdfUrl && (
                <iframe
                  title="Cover letter PDF preview"
                  src={coverLetterPdfUrl}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800"
                  height="560px"
                />
              )}
            </div>
          )}

          {activeTab === "recruiters" && (
            <div className="space-y-3">
              <button
                onClick={() => setResearchToken((v) => v + 1)}
                className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Research Recruiters
              </button>
              <RecruiterPanel
                jobId={job.id}
                company={job.company}
                role={job.title}
                jobDescription={job.jobDescription}
                hideHeaderButton
                autoResearchToken={researchToken}
                onProfilesFound={setProfiles}
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
                <EmailDrafter
                  jobId={job.id}
                  recruiter={
                    profiles[0] || {
                      name: job.recruiterName || "Hiring Team",
                      title: job.recruiterTitle || "Recruiter",
                      linkedinUrl: job.recruiterProfileUrl || "",
                      email: job.recruiterEmail || "",
                      confidence: 70,
                      source: "sheet",
                    }
                  }
                  jobListing={job}
                  resumeSummary={resumeSummary}
                />
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

      {showTailoredModal && tailoredResume && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-200 bg-[var(--surface)] shadow-xl dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-800">
              <h2 className="text-sm font-semibold">Tailored Resume</h2>
              <button
                onClick={() => setShowTailoredModal(false)}
                className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Close
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 p-3 text-xs dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={compileTailoredPdf}
                  disabled={tailoredPdfLoading}
                  className="h-9 rounded-md border border-zinc-200 px-3 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {tailoredPdfLoading ? "Compiling..." : "Generate PDF"}
                </button>
                {tailoredPdfBase64 && (
                  <button
                    onClick={() => downloadPdf(tailoredPdfBase64)}
                    className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    Download PDF
                  </button>
                )}
              </div>
              {tailoredPdfError && <p className="text-xs text-zinc-500">{tailoredPdfError}</p>}
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-sm whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
              {tailoredResume}
            </pre>
            {tailoredPdfBase64 && tailoredPdfUrl && (
              <iframe
                title="Tailored resume PDF preview"
                src={tailoredPdfUrl}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 mt-3"
                height="600px"
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
