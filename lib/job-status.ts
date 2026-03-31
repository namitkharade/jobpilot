import { JobStatus } from "@/types";

export const STATUS_OPTIONS: JobStatus[] = [
  "saved",
  "applied",
  "interviewing",
  "rejected",
  "ghosted",
];

const STATUS_LABELS: Record<JobStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  rejected: "Rejected",
  ghosted: "Ghosted",
};

const STATUS_CLASSES: Record<JobStatus, string> = {
  saved: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  applied: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/60",
  interviewing: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/60",
  rejected: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/60",
  ghosted: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60",
};

export function getStatusLabel(status: JobStatus): string {
  return STATUS_LABELS[status] || status;
}

export function getStatusClasses(status: JobStatus): string {
  return STATUS_CLASSES[status] || STATUS_CLASSES.saved;
}
