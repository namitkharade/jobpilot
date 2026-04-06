import { JobListing, JobSource, LinkedInTimeRange } from "@/types";
import axios from "axios";
import crypto from "crypto";
import { getConfig } from "./local-store";
import { normalizeJobListing } from "./job-normalize";

export interface ScrapeIssue {
  source: JobSource;
  actorId: string;
  error: string;
}

export interface ScrapeJobsResult {
  jobs: JobListing[];
  issues: ScrapeIssue[];
}

type ApifyPayload = Record<string, unknown>;
type ApifyItem = Record<string, unknown>;

const SOURCE_ACTOR_MAP: Record<
  JobSource,
  { actorId: string; payload: (query: string, location: string, timeRange?: LinkedInTimeRange) => ApifyPayload }
> = {
  linkedin: {
    actorId: "curious_coder/linkedin-jobs-scraper",
    payload: (query: string, location: string, timeRange?: LinkedInTimeRange) => ({
      urls: [buildLinkedInSearchUrl(query, location, timeRange)],
      count: 50,
      scrapeCompany: true,
    }),
  },
  indeed: {
    actorId: "misceres/indeed-scraper",
    payload: (query: string, location: string) => ({
      keywords: [query],
      location,
      country: inferCountryFromLocation(location),
      maxItems: 50,
      saveOnlyUniqueItems: true,
    }),
  },
};

const LINKEDIN_TIME_RANGE_PARAMS: Record<LinkedInTimeRange, string | null> = {
  any: null,
  past_1h: "r3600",
  past_24h: "r86400",
  past_48h: "r172800",
  past_week: "r604800",
  past_2weeks: "r1209600",
  past_month: "r2592000",
};

function buildLinkedInSearchUrl(
  query: string,
  location: string,
  timeRange?: LinkedInTimeRange
): string {
  const baseUrl = "https://www.linkedin.com/jobs/search/?";
  const params = new URLSearchParams({
    keywords: query,
    location,
    position: "1",
    pageNum: "0",
  });
  const timeParam = timeRange ? LINKEDIN_TIME_RANGE_PARAMS[timeRange] : null;
  if (timeParam) {
    params.set("f_TPR", timeParam);
  }
  return `${baseUrl}${params.toString()}`;
}

function getApifyToken(): string {
  return process.env.APIFY_API_TOKEN || getConfig().apiKeys.apify || "";
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const maybeError = (data as { error?: unknown }).error;
  if (!maybeError || typeof maybeError !== "object") return null;
  const message = (maybeError as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage = getApiErrorMessage(error.response?.data);
    if (status && apiMessage) return `${status}: ${apiMessage}`;
    if (status) return `${status}: ${error.message}`;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

// Helper with retry
async function fetchWithRetry(url: string, options: Record<string, unknown>, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await axios(url, options);
      return resp.data;
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(Math.pow(2, i) * 1000); // Exp backoff
    }
  }
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getFirstString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const found = value.find((item) => typeof item === "string");
    return typeof found === "string" ? found : "";
  }
  return "";
}

function inferCountryFromLocation(location: string): string {
  const normalized = location.toLowerCase();
  if (normalized.includes("germany")) return "Germany";
  if (normalized.includes("united kingdom") || normalized.includes("uk")) return "United Kingdom";
  if (normalized.includes("united states") || normalized.includes("usa") || normalized.includes("us")) return "United States";

  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1];
  return "Germany";
}

function formatIndeedLocation(item: ApifyItem): string {
  const raw = item.location;
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";

  const locationObj = raw as Record<string, unknown>;
  const city = getString(locationObj.city);
  const state = getString(locationObj.state);
  const country = getString(locationObj.country) || getString(locationObj.countryName);
  const formatted = [city, state].filter(Boolean).join(", ");
  if (formatted) return formatted;
  return country;
}

function normalizeJob(item: ApifyItem, source: JobSource): JobListing | null {
  let title = "";
  let company = "";
  let location = "";
  let salary = "";
  let applyUrl = "";
  let jobDescription = "";
  let companyDescription = "";
  let postedAt = "";
  let recruiterName = "";
  let recruiterTitle = "";
  let recruiterProfileUrl = "";
  let jobPosterName = "";
  let jobPosterTitle = "";

  if (source === "linkedin") {
    title = getString(item.jobTitle) || getString(item.title);
    company = getString(item.companyName) || getString(item.company);
    location = getString(item.location);
    const salaryInfo = Array.isArray(item.salaryInfo)
      ? (item.salaryInfo as unknown[]).filter((value) => typeof value === "string")
      : [];
    salary = salaryInfo.join(" - ") || getString(item.salary);
    applyUrl = getString(item.applyUrl) || getString(item.jobUrl) || getString(item.link);
    jobDescription =
      getString(item.descriptionText) ||
      getString(item.descriptionHtml) ||
      getString(item.description_text) ||
      getString(item.description_html) ||
      getString(item.jobDescription) ||
      getString(item.description);
    jobPosterName = getString(item.jobPosterName);
    jobPosterTitle = getString(item.jobPosterTitle);
    recruiterName = jobPosterName;
    recruiterTitle = jobPosterTitle;
    recruiterProfileUrl = getString(item.jobPosterProfileUrl);
    companyDescription = getString(item.companyDescription);
    postedAt = getString(item.publishedAt) || getString(item.postedAt) || getString(item.postedDate);
  } else if (source === "indeed") {
    title = getString(item.title) || getString(item.displayTitle);
    const companyObj = item.company && typeof item.company === "object" ? (item.company as Record<string, unknown>) : null;
    company = getString(item.companyName) || (companyObj ? getString(companyObj.companyName) : "") || getString(item.company);
    location = formatIndeedLocation(item) || getString(item.location);

    const salaryMin = getString(item.baseSalary_min);
    const salaryMax = getString(item.baseSalary_max);
    const salaryCurrency = getString(item.salary_currency);
    const salaryPeriod = getString(item.salary_period);
    if (salaryMin && salaryMax) {
      salary = `${salaryCurrency}${salaryMin} - ${salaryCurrency}${salaryMax} ${salaryPeriod}`.trim();
    } else {
      salary = getString(item.salary);
    }

    applyUrl = getString(item.applyUrl) || getString(item.jobUrl) || getString(item.url);
    jobDescription = getString(item.description_text) || getString(item.description_html) || getString(item.description);
    companyDescription = getString(item.companyDescription) || getString(item.company_description);
    postedAt = getString(item.datePublished) || getString(item.dateScraped) || getString(item.dateOnIndeed);
  }

  // Ensure minimum viable data (some items might be empty or missing critical info)
  if (!title || !company) return null;

  const idString = `${company}-${title}-${location}`.toLowerCase();
  const id = crypto.createHash("md5").update(idString).digest("hex");

  return normalizeJobListing({
    id,
    title,
    company,
    location,
    salary,
    jobType: getString(item.jobType) || getFirstString(item.jobTypes) || getString(item.contractType) || getString(item.employmentType),
    postedAt,
    scrapedAt: new Date().toISOString(),
    applyUrl,
    jobDescription,
    companyDescription,
    atsScore: null,
    atsKeywordGaps: [],
    atsSuggestions: [],
    status: "saved",
    recruiterName,
    recruiterTitle,
    recruiterProfileUrl,
    recruiterEmail: "",
    emailDraft: "",
    jobPosterName,
    jobPosterTitle,
    source
  });
}

async function runActorAndFetchResults(
  actorId: string,
  payload: ApifyPayload,
  source: JobSource
): Promise<{ jobs: JobListing[]; issue?: ScrapeIssue }> {
  const apiToken = getApifyToken();
  if (!apiToken) {
    const error = "APIFY_API_TOKEN is not set";
    console.warn(error);
    return { jobs: [], issue: { source, actorId, error } };
  }

  const encodedActorId = actorId.replace("/", "~");
  const authHeaders = {
    Authorization: `Bearer ${apiToken}`,
  };

  try {
    // 1. Trigger actor
    const runResponse = await fetchWithRetry(
      `https://api.apify.com/v2/acts/${encodedActorId}/runs`,
      {
        method: 'POST',
        headers: authHeaders,
        data: payload,
      }
    );

    const runId = runResponse.data.id;

    // 2. Poll for SUCCEEDED status (max 3 mins = 180s = 36 loops of 5s)
    let status = runResponse.data.status;
    let attempts = 0;
    while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED" && status !== "TIMED-OUT" && attempts < 36) {
      await sleep(5000);
      const statusResponse = await fetchWithRetry(
        `https://api.apify.com/v2/actor-runs/${runId}`,
        {
          method: 'GET',
          headers: authHeaders,
        }
      );
      status = statusResponse.data.status;
      attempts++;
    }

    if (status !== "SUCCEEDED") {
      const error = `Actor run ended with status ${status}`;
      console.warn(`Actor ${actorId} finished with status ${status}`);
      return { jobs: [], issue: { source, actorId, error } };
    }

    // 3. Fetch results
    const resultsResponse = await fetchWithRetry(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items`,
      {
        method: 'GET',
        headers: authHeaders,
      }
    );

    const items = resultsResponse || [];
    
    // 4. Normalize results
    const normalized = (items as ApifyItem[])
      .map((item) => normalizeJob(item, source))
      .filter((job): job is JobListing => job !== null);

    return { jobs: normalized };

  } catch (error) {
    const message = getErrorMessage(error);
    console.error(`Error running actor ${actorId}: ${message}`);
    // Don't throw here to allow other scrapers to finish.
    return { jobs: [], issue: { source, actorId, error: message } };
  }
}

export async function scrapeJobsDetailed(
  query: string,
  location: string,
  selectedSources?: JobSource[],
  timeRange?: LinkedInTimeRange
): Promise<ScrapeJobsResult> {
  const sources: JobSource[] = selectedSources?.length
    ? selectedSources
    : ["linkedin", "indeed"];

  const runs = sources.map((source) => {
    const config = SOURCE_ACTOR_MAP[source];
    return runActorAndFetchResults(config.actorId, config.payload(query, location, timeRange), source);
  });

  // Trigger selected actors in parallel
  const results = await Promise.all(runs);

  const allJobs = results.flatMap((result) => result.jobs);
  const issues = results
    .map((result) => result.issue)
    .filter((issue): issue is ScrapeIssue => Boolean(issue));

  // Deduplicate by deterministic ID
  const jobMap = new Map<string, JobListing>();
  for (const job of allJobs) {
    if (!jobMap.has(job.id)) {
      jobMap.set(job.id, job);
    }
  }

  return {
    jobs: Array.from(jobMap.values()),
    issues,
  };
}

export async function scrapeJobs(
  query: string,
  location: string,
  selectedSources?: JobSource[],
  timeRange?: LinkedInTimeRange
): Promise<JobListing[]> {
  const result = await scrapeJobsDetailed(query, location, selectedSources, timeRange);
  return result.jobs;
}
