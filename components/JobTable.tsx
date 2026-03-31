"use client";

import { STATUS_OPTIONS, getStatusClasses } from "@/lib/job-status";
import { JobListing, JobSource, JobStatus } from "@/types";
import clsx from "clsx";
import { format } from "date-fns";
import { useMemo, useState } from "react";

interface JobTableProps {
  jobs: JobListing[];
  loading?: boolean;
  onSelect: (job: JobListing) => void;
  onStatusChange: (id: string, status: JobStatus) => void;
  onDeleteJob?: (id: string) => void;
}

type SortBy = "date" | "ats" | "company" | "salary";

const SOURCE_OPTIONS: Array<JobSource | "all"> = [
  "all",
  "linkedin",
  "indeed",
];

function getAtsClasses(score: number | null) {
  if (score === null) {
    return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  }
  if (score >= 75) {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300";
  }
  if (score >= 50) {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
  }
  return "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300";
}

function parseSalary(salary: string): number {
  const numbers = salary.match(/\d+/g);
  if (!numbers || numbers.length === 0) return 0;
  return Number(numbers[0]);
}

export default function JobTable({ jobs, loading, onSelect, onStatusChange, onDeleteJob }: JobTableProps) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<JobSource | "all">("all");
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [minAts, setMinAts] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("date");

  const rows = useMemo(() => {
    const filtered = jobs
      .filter((job) => {
        if (!search.trim()) return true;
        const text = `${job.title} ${job.company} ${job.location}`.toLowerCase();
        return text.includes(search.trim().toLowerCase());
      })
      .filter((job) => source === "all" || job.source === source)
      .filter((job) => status === "all" || job.status === status)
      .filter((job) => (job.atsScore ?? 0) >= minAts);

    filtered.sort((a, b) => {
      if (sortBy === "ats") return (b.atsScore ?? -1) - (a.atsScore ?? -1);
      if (sortBy === "company") return a.company.localeCompare(b.company);
      if (sortBy === "salary") return parseSalary(b.salary) - parseSalary(a.salary);
      return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
    });

    return filtered;
  }, [jobs, minAts, search, sortBy, source, status]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 bg-[var(--surface)] p-3 dark:border-zinc-800">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.6fr_repeat(4,minmax(0,1fr))]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by keyword"
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 transition focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
          />

          <select
            value={source}
            onChange={(e) => setSource(e.target.value as JobSource | "all")}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 transition focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {SOURCE_OPTIONS.map((item) => (
              <option key={item} value={item}>
                Source: {item === "all" ? "All" : item}
              </option>
            ))}
          </select>

          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as JobStatus | "all")}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 transition focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="all">Status: All</option>
            {STATUS_OPTIONS.map((item) => (
              <option key={item} value={item}>
                Status: {item}
              </option>
            ))}
          </select>

          <div className="rounded-md border border-zinc-200 bg-white px-3 py-1 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
              <span>Min ATS</span>
              <span>{minAts}</span>
            </div>
            <input
              value={minAts}
              min={0}
              max={100}
              type="range"
              onChange={(e) => setMinAts(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 transition focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="date">Sort: Date</option>
            <option value="ats">Sort: ATS Score</option>
            <option value="company">Sort: Company</option>
            <option value="salary">Sort: Salary</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-[var(--surface)] dark:border-zinc-800">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b border-zinc-200 bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Company</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Salary</th>
              <th className="px-3 py-2 text-left">ATS Score</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading &&
              Array.from({ length: 6 }).map((_, index) => (
                <tr key={`skeleton_${index}`} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="px-3 py-3">
                    <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-4 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-5 w-14 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-8 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
                  </td>
                </tr>
              ))}

            {!loading &&
              rows.map((job) => (
              <tr
                key={job.id}
                className={clsx(
                  "cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/60",
                  (job.atsScore ?? 0) > 75 && "border-l-2 border-l-emerald-500"
                )}
                onClick={() => onSelect(job)}
              >
                <td className="px-3 py-3 text-zinc-500">
                  {job.postedAt
                    ? format(new Date(job.postedAt), "MMM d")
                    : "-"}
                </td>
                <td className="px-3 py-3 font-medium">{job.title}</td>
                <td className="px-3 py-3">{job.company}</td>
                <td className="px-3 py-3 text-zinc-500">{job.location}</td>
                <td className="px-3 py-3 text-zinc-500">{job.salary || "-"}</td>
                <td className="px-3 py-3">
                  <span className={clsx("rounded-full px-2 py-1 text-xs font-semibold", getAtsClasses(job.atsScore))}>
                    {job.atsScore ?? "N/A"}
                  </span>
                </td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={job.status}
                    onChange={(e) => onStatusChange(job.id, e.target.value as JobStatus)}
                    className={clsx(
                      "h-8 rounded-md border px-2 text-xs font-medium",
                      getStatusClasses(job.status)
                    )}
                  >
                    {STATUS_OPTIONS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    {job.applyUrl ? (
                      <a
                        href={job.applyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium underline hover:text-zinc-500"
                      >
                        Apply
                      </a>
                    ) : (
                      <span className="text-xs text-zinc-500">No link</span>
                    )}

                    {onDeleteJob && (
                      <button
                        type="button"
                        onClick={() => onDeleteJob(job.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-rose-600 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        aria-label="Delete job"
                        title="Delete job"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-sm text-zinc-500">
                  No jobs match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
