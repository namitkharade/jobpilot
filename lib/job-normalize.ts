import { JobListing, JobStatus } from "@/types";

const VALID_STATUSES: JobStatus[] = ["saved", "applied", "interviewing", "rejected", "ghosted"];

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function repairJobDescriptionMapping(job: JobListing): JobListing {
  const brokenDescriptionInProfileUrl =
    !job.jobDescription.trim() &&
    job.recruiterProfileUrl.trim().length > 100 &&
    !isLikelyUrl(job.recruiterProfileUrl);

  if (!brokenDescriptionInProfileUrl) {
    return job;
  }

  return {
    ...job,
    jobDescription: job.recruiterProfileUrl,
    recruiterProfileUrl: "",
  };
}

export function normalizeJobListing(input: Partial<JobListing>): JobListing {
  const normalized: JobListing = {
    id: asString(input.id),
    title: asString(input.title),
    company: asString(input.company),
    location: asString(input.location),
    salary: asString(input.salary),
    jobType: asString(input.jobType),
    postedAt: asString(input.postedAt),
    scrapedAt: asString(input.scrapedAt),
    applyUrl: asString(input.applyUrl),
    jobDescription: asString(input.jobDescription),
    companyDescription: asString(input.companyDescription),
    atsScore: typeof input.atsScore === "number" ? input.atsScore : null,
    atsKeywordGaps: asStringArray(input.atsKeywordGaps),
    atsSuggestions: Array.isArray(input.atsSuggestions) ? input.atsSuggestions : [],
    status: VALID_STATUSES.includes(input.status as JobStatus) ? (input.status as JobStatus) : "saved",
    recruiterName: asString(input.recruiterName),
    recruiterTitle: asString(input.recruiterTitle),
    recruiterProfileUrl: asString(input.recruiterProfileUrl),
    recruiterEmail: asString(input.recruiterEmail),
    emailDraft: asString(input.emailDraft),
    source: input.source === "indeed" ? "indeed" : "linkedin",
    jobPosterName: asString(input.jobPosterName),
    jobPosterTitle: asString(input.jobPosterTitle),
  };

  return repairJobDescriptionMapping(normalized);
}
