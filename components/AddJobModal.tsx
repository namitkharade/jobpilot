"use client";

import { useToast } from "@/components/ToastProvider";
import { normalizeJobListing } from "@/lib/job-normalize";
import { JobImportDraft, JobImportMethod, JobListing, JobSource, JobStatus } from "@/types";
import { startTransition, useCallback, useRef, useState } from "react";

interface AddJobModalProps {
  open: boolean;
  onClose: () => void;
  onJobAdded?: () => Promise<unknown> | unknown;
}

interface AddJobImportState {
  status: "idle" | "loading" | "success" | "error";
  message: string;
  warnings: string[];
  extractedVia: JobImportMethod | null;
}

type AddJobFormState = JobImportDraft & {
  status: JobStatus;
};

const EMPTY_IMPORT_STATE: AddJobImportState = {
  status: "idle",
  message: "",
  warnings: [],
  extractedVia: null,
};

function createEmptyForm(): AddJobFormState {
  return {
    title: "",
    company: "",
    location: "",
    salary: "",
    jobType: "Full-time",
    source: "manual",
    applyUrl: "",
    jobDescription: "",
    companyDescription: "",
    postedAt: "",
    jobPosterName: "",
    jobPosterTitle: "",
    status: "saved",
  };
}

function isProbablyHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(trimmed);
    return /^https?:$/i.test(url.protocol);
  } catch {
    return false;
  }
}

function buildImportMessage(method: JobImportMethod | null, warnings: string[]): string {
  if (!method) return "";
  if (method === "openai-fallback") {
    return warnings.length ? "Imported with AI fallback. Review the filled fields before saving." : "Imported with AI fallback.";
  }
  return `Imported from ${method}.`;
}

export default function AddJobModal({ open, onClose, onJobAdded }: AddJobModalProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<AddJobFormState>(createEmptyForm);
  const [addJobLoading, setAddJobLoading] = useState(false);
  const [importState, setImportState] = useState<AddJobImportState>(EMPTY_IMPORT_STATE);
  const importRequestIdRef = useRef(0);

  const closeModal = useCallback(() => {
    if (addJobLoading) return;
    importRequestIdRef.current += 1;
    onClose();
  }, [addJobLoading, onClose]);

  const performImport = useCallback(
    async (url: string) => {
      const nextUrl = url.trim();
      if (!isProbablyHttpUrl(nextUrl)) {
        setImportState({
          status: "error",
          message: "Paste a valid http or https job URL to auto-fill this form.",
          warnings: [],
          extractedVia: null,
        });
        return;
      }

      const requestId = ++importRequestIdRef.current;

      setForm((current) => ({
        ...current,
        applyUrl: nextUrl,
      }));
      setImportState({
        status: "loading",
        message: "Importing job details from the pasted URL...",
        warnings: [],
        extractedVia: null,
      });

      try {
        const response = await fetch("/api/jobs/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: nextUrl }),
        });
        const payload = (await response.json()) as {
          success?: boolean;
          error?: string;
          data?: JobImportDraft;
          warnings?: string[];
          extractedVia?: JobImportMethod;
        };

        if (requestId !== importRequestIdRef.current) {
          return;
        }

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.error || "Failed to import job details");
        }

        startTransition(() => {
          setForm((current) => ({
            ...current,
            ...payload.data,
            status: current.status,
          }));
          setImportState({
            status: "success",
            message: buildImportMessage(payload.extractedVia || null, payload.warnings || []),
            warnings: payload.warnings || [],
            extractedVia: payload.extractedVia || null,
          });
        });
      } catch (error) {
        if (requestId !== importRequestIdRef.current) {
          return;
        }

        setImportState({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to import job details",
          warnings: [],
          extractedVia: null,
        });
      }
    },
    []
  );

  const submitAddJob = useCallback(async () => {
    if (!form.title.trim() || !form.company.trim()) {
      toast("Title and Company are required", "info");
      return;
    }

    setAddJobLoading(true);

    try {
      const now = new Date().toISOString();
      const job: JobListing = normalizeJobListing({
        id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: form.title.trim(),
        company: form.company.trim(),
        location: form.location.trim(),
        salary: form.salary.trim(),
        jobType: form.jobType.trim(),
        source: form.source,
        applyUrl: form.applyUrl.trim(),
        jobDescription: form.jobDescription.trim(),
        companyDescription: form.companyDescription.trim(),
        status: form.status,
        postedAt: form.postedAt.trim() || now,
        scrapedAt: now,
        atsScore: null,
        atsKeywordGaps: [],
        atsSuggestions: [],
        recruiterName: "",
        recruiterTitle: "",
        recruiterProfileUrl: "",
        recruiterEmail: "",
        emailDraft: "",
        jobPosterName: form.jobPosterName.trim(),
        jobPosterTitle: form.jobPosterTitle.trim(),
      });

      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(job),
      });
      const payload = (await response.json()) as { success?: boolean; error?: string };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Failed to add job");
      }

      toast("Job added successfully", "success");
      await onJobAdded?.();
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to add job", "error");
    } finally {
      setAddJobLoading(false);
    }
  }, [form, onClose, onJobAdded, toast]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/45 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-zinc-200 bg-[var(--surface)] p-5 shadow-xl dark:border-zinc-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add Job Manually</h2>
          <button
            className="text-sm text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
            disabled={addJobLoading}
            onClick={closeModal}
          >
            Close
          </button>
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAddJob();
          }}
        >
          <div>
            <label htmlFor="job-title" className="mb-1 block text-xs text-zinc-500">
              Job Title
            </label>
            <input
              id="job-title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label htmlFor="job-company" className="mb-1 block text-xs text-zinc-500">
              Company
            </label>
            <input
              id="job-company"
              value={form.company}
              onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label htmlFor="job-location" className="mb-1 block text-xs text-zinc-500">
              Location
            </label>
            <input
              id="job-location"
              value={form.location}
              onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label htmlFor="job-salary" className="mb-1 block text-xs text-zinc-500">
              Salary
            </label>
            <input
              id="job-salary"
              value={form.salary}
              onChange={(event) => setForm((current) => ({ ...current, salary: event.target.value }))}
              placeholder="$120k - $160k"
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label htmlFor="job-type" className="mb-1 block text-xs text-zinc-500">
              Job Type
            </label>
            <select
              id="job-type"
              value={form.jobType}
              onChange={(event) => setForm((current) => ({ ...current, jobType: event.target.value }))}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="Full-time">Full-time</option>
              <option value="Part-time">Part-time</option>
              <option value="Contract">Contract</option>
              <option value="Internship">Internship</option>
            </select>
          </div>
          <div>
            <label htmlFor="job-source" className="mb-1 block text-xs text-zinc-500">
              Job Source
            </label>
            <select
              id="job-source"
              value={form.source}
              onChange={(event) => setForm((current) => ({ ...current, source: event.target.value as JobSource }))}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="manual">manual</option>
              <option value="linkedin">linkedin</option>
              <option value="indeed">indeed</option>
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <label htmlFor="job-apply-url" className="block text-xs text-zinc-500">
                Apply URL
              </label>
              <button
                type="button"
                onClick={() => void performImport(form.applyUrl)}
                disabled={importState.status === "loading" || !isProbablyHttpUrl(form.applyUrl)}
                className="text-xs font-medium text-zinc-600 underline disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-300"
              >
                {importState.status === "loading" ? "Importing..." : "Retry import"}
              </button>
            </div>
            <input
              id="job-apply-url"
              value={form.applyUrl}
              onChange={(event) => {
                const nextUrl = event.target.value;
                setForm((current) => ({ ...current, applyUrl: nextUrl }));
                if (importState.status !== "idle") {
                  setImportState(EMPTY_IMPORT_STATE);
                }
              }}
              onPaste={(event) => {
                const pastedText = event.clipboardData.getData("text").trim();
                if (!isProbablyHttpUrl(pastedText)) {
                  return;
                }

                event.preventDefault();
                setForm((current) => ({ ...current, applyUrl: pastedText }));
                void performImport(pastedText);
              }}
              className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {importState.status !== "idle" && (
              <div
                className={`mt-2 rounded-md border px-3 py-2 text-sm ${
                  importState.status === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                    : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                }`}
              >
                <p>{importState.message}</p>
                {importState.extractedVia && importState.status === "success" ? (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Method: {importState.extractedVia}</p>
                ) : null}
                {importState.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {importState.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="job-description" className="mb-1 block text-xs text-zinc-500">
              Job Description
            </label>
            <textarea
              id="job-description"
              value={form.jobDescription}
              onChange={(event) => setForm((current) => ({ ...current, jobDescription: event.target.value }))}
              className="min-h-[120px] w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label htmlFor="job-status" className="mb-1 block text-xs text-zinc-500">
              Status
            </label>
            <select
              id="job-status"
              value={form.status}
              onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as JobStatus }))}
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
              onClick={closeModal}
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
  );
}
