"use client";

import JobTable from "@/components/JobTable";
import ResumeEditor from "@/components/ResumeEditor";
import { useToast } from "@/components/ToastProvider";
import { normalizeJobListing } from "@/lib/job-normalize";
import { JobListing, JobSource, JobStatus, LinkedInTimeRange } from "@/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

const DEMO_JOBS: JobListing[] = [
  normalizeJobListing({
    id: "demo_1",
    title: "Senior Frontend Engineer",
    company: "Stripe",
    location: "San Francisco, CA",
    salary: "$180k - $250k",
    jobType: "Full-time",
    postedAt: "2026-03-20T09:00:00Z",
    scrapedAt: "2026-03-20T09:10:00Z",
    applyUrl: "https://stripe.com/jobs",
    jobDescription: "Senior frontend role focused on TypeScript and React.",
    companyDescription: "",
    atsScore: 87,
    atsKeywordGaps: ["payments"],
    atsSuggestions: [
      { section: "experience", bulletIndex: 0, original: "Software engineering", suggested: "Payments infrastructure engineering", reason: "Directly matches Stripe's core business", keywordsAdded: ["payments"] }
    ],
    status: "applied",
    recruiterName: "",
    recruiterTitle: "",
    recruiterProfileUrl: "",
    recruiterEmail: "",
    emailDraft: "",
    jobPosterName: "",
    jobPosterTitle: "",
    source: "linkedin",
  }),
  normalizeJobListing({
    id: "demo_2",
    title: "Software Engineer",
    company: "Notion",
    location: "New York, NY",
    salary: "$150k - $200k",
    jobType: "Full-time",
    postedAt: "2026-03-20T08:00:00Z",
    scrapedAt: "2026-03-20T09:10:00Z",
    applyUrl: "https://notion.so/careers",
    jobDescription: "Build collaborative workflows and editor features.",
    companyDescription: "",
    atsScore: 73,
    atsKeywordGaps: ["collaboration"],
    atsSuggestions: [
      { section: "experience", bulletIndex: 1, original: "Built apps", suggested: "Architected collaborative editor workflows", reason: "Aligns with Notion's product focus", keywordsAdded: ["collaboration"] }
    ],
    status: "saved",
    recruiterName: "",
    recruiterTitle: "",
    recruiterProfileUrl: "",
    recruiterEmail: "",
    emailDraft: "",
    jobPosterName: "",
    jobPosterTitle: "",
    source: "indeed",
  }),
  normalizeJobListing({
    id: "demo_3",
    title: "Backend Engineer",
    company: "Linear",
    location: "Remote",
    salary: "$145k - $195k",
    jobType: "Full-time",
    postedAt: "2026-03-19T18:00:00Z",
    scrapedAt: "2026-03-20T09:10:00Z",
    applyUrl: "https://linear.app/careers",
    jobDescription: "Node and Postgres backend role.",
    companyDescription: "",
    atsScore: 61,
    atsKeywordGaps: ["graphql"],
    atsSuggestions: [
      { section: "skills", bulletIndex: 0, original: "Node.js", suggested: "Node.js with GraphQL and Apollo", reason: "Linear uses GraphQL extensively", keywordsAdded: ["graphql"] }
    ],
    status: "interviewing",
    recruiterName: "",
    recruiterTitle: "",
    recruiterProfileUrl: "",
    recruiterEmail: "",
    emailDraft: "",
    jobPosterName: "",
    jobPosterTitle: "",
    source: "indeed",
  }),
];

const EMPTY_FORM = {
  title: "",
  company: "",
  location: "",
  salary: "",
  jobType: "Full-time",
  source: "linkedin" as JobSource,
  applyUrl: "",
  jobDescription: "",
  status: "saved" as JobStatus,
};

const TIME_RANGE_OPTIONS: Array<{ value: LinkedInTimeRange; label: string }> = [
  { value: "any", label: "Any time" },
  { value: "past_1h", label: "Last 1 hour" },
  { value: "past_24h", label: "Last 24 hours" },
  { value: "past_48h", label: "Last 48 hours" },
  { value: "past_week", label: "Last 1 week" },
  { value: "past_2weeks", label: "Last 2 weeks" },
  { value: "past_month", label: "Last 1 month" },
];

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [scrapeSource, setScrapeSource] = useState<JobSource | "all">("all");
  const [timeRange, setTimeRange] = useState<LinkedInTimeRange>("any");
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [progressCount, setProgressCount] = useState(0);

  const [addJobForm, setAddJobForm] = useState(EMPTY_FORM);
  const [addJobLoading, setAddJobLoading] = useState(false);

  const fetcher = useCallback(async (url: string) => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load jobs");
      }

      return (Array.isArray(data.data) && data.data.length > 0 ? data.data : DEMO_JOBS) as JobListing[];
    } catch (err) {
      console.warn("Failed to fetch jobs:", err);
      return DEMO_JOBS;
    }
  }, []);

  const {
    data: jobs = DEMO_JOBS,
    error,
    isLoading,
    mutate,
  } = useSWR<JobListing[]>("/api/jobs", fetcher, {
    refreshInterval: 5 * 60 * 1000,
    fallbackData: DEMO_JOBS,
    revalidateOnFocus: true,
  });

  if (error) {
    throw error;
  }

  const handleStatusChange = useCallback(
    async (id: string, status: JobStatus) => {
      await mutate(
        async (current) => {
          const existing = (current || []).find((job) => job.id === id);
          if (!existing) return current;

          const optimistic = (current || []).map((job) => (job.id === id ? { ...job, status } : job));

          try {
            await fetch("/api/jobs", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...existing, status }),
            });
          } catch {
            toast("Failed to update status", "error");
          }

          return optimistic;
        },
        {
          optimisticData: (current) => (current || []).map((job) => (job.id === id ? { ...job, status } : job)),
          rollbackOnError: true,
          revalidate: true,
        }
      );

    },
    [mutate, toast]
  );

  const handleDeleteJob = useCallback(
    async (id: string) => {
      await mutate(
        async (current) => {
          const existing = (current || []).find((job) => job.id === id);
          if (!existing) return current;

          try {
            const res = await fetch("/api/jobs", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
              throw new Error(data.error || "Failed to delete job");
            }
            toast("Job deleted", "success");
          } catch (error: unknown) {
            toast(error instanceof Error ? error.message : "Failed to delete job", "error");
            throw error;
          }

          return (current || []).filter((job) => job.id !== id);
        },
        {
          optimisticData: (current) => (current || []).filter((job) => job.id !== id),
          rollbackOnError: true,
          revalidate: true,
        }
      );
    },
    [mutate, toast]
  );

  const runScrape = useCallback(async () => {
    if (!role.trim() || !location.trim()) return;

    setScrapeLoading(true);
    setProgressCount(0);

    const timer = setInterval(() => {
      setProgressCount((current) => current + Math.floor(Math.random() * 3 + 1));
    }, 900);

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: role.trim(),
          location: location.trim(),
          source: scrapeSource,
          timeRange,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const discovered = Number(data.scraped || data.newJobs || 0);
        setProgressCount((count) => Math.max(count, discovered));
        toast(`Scrape complete: ${Number(data.newJobs || 0)} new jobs`, "success");
        await mutate();
      } else {
        toast(data.error || "Scrape failed", "error");
      }
    } finally {
      clearInterval(timer);
      setScrapeLoading(false);
    }
  }, [location, mutate, role, scrapeSource, timeRange, toast]);

  const submitAddJob = useCallback(async () => {
    if (!addJobForm.title.trim() || !addJobForm.company.trim()) {
      toast("Title and Company are required", "info");
      return;
    }

    setAddJobLoading(true);
    try {
      const now = new Date().toISOString();
      const job: JobListing = normalizeJobListing({
        id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: addJobForm.title.trim(),
        company: addJobForm.company.trim(),
        location: addJobForm.location.trim(),
        salary: addJobForm.salary.trim(),
        jobType: addJobForm.jobType,
        source: addJobForm.source,
        applyUrl: addJobForm.applyUrl.trim(),
        jobDescription: addJobForm.jobDescription.trim(),
        companyDescription: "",
        status: addJobForm.status,
        postedAt: now,
        scrapedAt: now,
        atsScore: null,
        atsKeywordGaps: [],
        atsSuggestions: [],
        recruiterName: "",
        recruiterTitle: "",
        recruiterProfileUrl: "",
        recruiterEmail: "",
        emailDraft: "",
        jobPosterName: "",
        jobPosterTitle: "",
      });

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed to add job");

      toast("Job added successfully", "success");
      setAddJobForm(EMPTY_FORM);
      setAddJobOpen(false);
      await mutate();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to add job", "error");
    } finally {
      setAddJobLoading(false);
    }
  }, [addJobForm, mutate, toast]);

  const stats = useMemo(() => {
    const today = new Date().toDateString();
    const totalToday = jobs.filter((job) => new Date(job.postedAt).toDateString() === today).length;

    const scored = jobs.filter((job) => job.atsScore !== null).map((job) => Number(job.atsScore));
    const avgAts = scored.length ? Math.round(scored.reduce((acc, score) => acc + score, 0) / scored.length) : 0;

    const sent = jobs.filter((job) => job.status !== "saved").length;
    const replied = jobs.filter((job) => job.status === "interviewing" || job.status === "rejected").length;
    const responseRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;

    return { totalToday, avgAts, sent, responseRate, replied };
  }, [jobs]);

  const [lastUpdatedText, setLastUpdatedText] = useState("--:--:--");

  useEffect(() => {
    setLastUpdatedText(new Date().toLocaleTimeString());
  }, [jobs]);

  return (
    <main className="p-4 md:p-7">
      <section className="mb-4 flex flex-col gap-3 border-b border-zinc-200 pb-4 md:flex-row md:items-center md:justify-between dark:border-zinc-800">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">JobPilot</h1>
          <p className="text-sm text-zinc-500">Your AI-powered job hunt co-pilot</p>
          <p className="text-xs text-zinc-500">Last updated: {lastUpdatedText}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setScrapeOpen(true)}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Scrape New Jobs
          </button>
          <button
            onClick={() => setAddJobOpen(true)}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Add Job
          </button>
          <button
            onClick={() => setResumeOpen(true)}
            className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Upload Resume
          </button>
        </div>
      </section>

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-3 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Total jobs today</p>
          <p className="mt-2 text-2xl font-semibold">{stats.totalToday}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-3 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Avg ATS score</p>
          <p className="mt-2 text-2xl font-semibold">{stats.avgAts}%</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-3 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Applications sent</p>
          <p className="mt-2 text-2xl font-semibold">{stats.sent}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-3 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Response rate (sent/replied)</p>
          <p className="mt-2 text-2xl font-semibold">{stats.responseRate}%</p>
          <p className="text-xs text-zinc-500">{stats.sent}/{stats.replied}</p>
        </div>
      </section>

      <JobTable
        jobs={jobs}
        loading={isLoading}
        onSelect={(job) => router.push(`/jobs/${job.id}`)}
        onStatusChange={handleStatusChange}
        onDeleteJob={handleDeleteJob}
      />

      {scrapeOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-[var(--surface)] p-5 shadow-xl dark:border-zinc-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Scrape New Jobs</h2>
              <button
                className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={() => {
                  if (!scrapeLoading) setScrapeOpen(false);
                }}
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Role</label>
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="e.g. Product Engineer"
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Location</label>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Remote"
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Source</label>
                <select
                  value={scrapeSource}
                  onChange={(e) => setScrapeSource(e.target.value as JobSource | "all")}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="all">All Sources</option>
                  <option value="linkedin">LinkedIn Only</option>
                  <option value="indeed">Indeed Only</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Posted in</label>
                <select
                  value={timeRange}
                  onChange={(e) => setTimeRange(e.target.value as LinkedInTimeRange)}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {TIME_RANGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={runScrape}
                disabled={scrapeLoading || !role.trim() || !location.trim()}
                className="h-9 w-full rounded-md bg-zinc-900 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {scrapeLoading ? "Running..." : "Run Scrape"}
              </button>

              {(scrapeLoading || progressCount > 0) && (
                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="font-medium">Scrape progress</p>
                  <p className="text-zinc-500">Jobs discovered: {progressCount}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {addJobOpen && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 p-4">
          <div className="w-full max-w-lg overflow-y-auto max-h-[90vh] rounded-lg border border-zinc-200 bg-[var(--surface)] p-5 shadow-xl dark:border-zinc-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Add Job Manually</h2>
              <button
                className="text-sm text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
                disabled={addJobLoading}
                onClick={() => {
                  if (addJobLoading) return;
                  setAddJobForm(EMPTY_FORM);
                  setAddJobOpen(false);
                }}
              >
                Close
              </button>
            </div>

            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                submitAddJob();
              }}
            >
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Job Title</label>
                <input
                  value={addJobForm.title}
                  onChange={(e) => setAddJobForm((current) => ({ ...current, title: e.target.value }))}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Company</label>
                <input
                  value={addJobForm.company}
                  onChange={(e) => setAddJobForm((current) => ({ ...current, company: e.target.value }))}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Location</label>
                <input
                  value={addJobForm.location}
                  onChange={(e) => setAddJobForm((current) => ({ ...current, location: e.target.value }))}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Salary</label>
                <input
                  value={addJobForm.salary}
                  onChange={(e) => setAddJobForm((current) => ({ ...current, salary: e.target.value }))}
                  placeholder="$120k - $160k"
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Job Type</label>
                <select
                  value={addJobForm.jobType}
                  onChange={(e) => setAddJobForm((current) => ({ ...current, jobType: e.target.value }))}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="Full-time">Full-time</option>
                  <option value="Part-time">Part-time</option>
                  <option value="Contract">Contract</option>
                  <option value="Internship">Internship</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Job Source</label>
                <select
                  value={addJobForm.source}
                  onChange={(e) => setAddJobForm((current) => ({ ...current, source: e.target.value as JobSource }))}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="linkedin">linkedin</option>
                  <option value="indeed">indeed</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Apply URL</label>
                <input
                  value={addJobForm.applyUrl}
                  onChange={(e) => setAddJobForm((current) => ({ ...current, applyUrl: e.target.value }))}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Job Description</label>
                <textarea
                  value={addJobForm.jobDescription}
                  onChange={(e) => setAddJobForm((current) => ({ ...current, jobDescription: e.target.value }))}
                  className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 min-h-[120px]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Status</label>
                <select
                  value={addJobForm.status}
                  onChange={(e) => setAddJobForm((current) => ({ ...current, status: e.target.value as JobStatus }))}
                  className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="saved">saved</option>
                  <option value="applied">applied</option>
                  <option value="interviewing">interviewing</option>
                  <option value="rejected">rejected</option>
                  <option value="ghosted">ghosted</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                  disabled={addJobLoading}
                  onClick={() => {
                    if (addJobLoading) return;
                    setAddJobForm(EMPTY_FORM);
                    setAddJobOpen(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addJobLoading}
                  className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {addJobLoading ? "Adding..." : "Add Job"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resumeOpen && (
        <div className="fixed inset-0 z-40 bg-black/45 p-3 md:p-8">
          <div className="mx-auto h-full max-w-5xl overflow-auto rounded-lg border border-zinc-200 bg-[var(--surface)] p-4 shadow-xl dark:border-zinc-800">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Resume Editor</h2>
              <button
                className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={() => setResumeOpen(false)}
              >
                Close
              </button>
            </div>
            <ResumeEditor />
          </div>
        </div>
      )}
    </main>
  );
}
