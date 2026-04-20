import { JobListing } from "@/types";
import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { normalizeJobListing } from "./job-normalize";

type JobRow = {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  job_type: string;
  source: string;
  posted_at: string;
  scraped_at: string;
  apply_url: string;
  status: string;
  ats_score: number | null;
  recruiter_name: string;
  recruiter_email: string;
  recruiter_profile_url: string;
  job_description: string;
  ats_keyword_gaps: unknown;
  ats_suggestions: unknown;
  company_description: string;
  recruiter_title: string;
  email_draft: string;
  job_poster_name: string;
  job_poster_title: string;
  company_domain: string;
  company_intel: unknown;
  recruiter_candidates: unknown;
  selected_recruiter_id: string;
  outreach: unknown;
};

let sqlClient: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

function getConnectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

export function hasPostgresConfigured() {
  return Boolean(getConnectionString());
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function getSql(): NeonQueryFunction<false, false> {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL or POSTGRES_URL environment variable.");
  }

  if (!sqlClient) {
    sqlClient = neon(connectionString);
  }

  return sqlClient;
}

async function ensureSchema() {
  if (schemaReady) {
    return schemaReady;
  }

  const sql = getSql();
  schemaReady = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        company TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        salary TEXT NOT NULL DEFAULT '',
        job_type TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'linkedin',
        posted_at TEXT NOT NULL DEFAULT '',
        scraped_at TEXT NOT NULL DEFAULT '',
        apply_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'saved',
        ats_score INTEGER,
        recruiter_name TEXT NOT NULL DEFAULT '',
        recruiter_email TEXT NOT NULL DEFAULT '',
        recruiter_profile_url TEXT NOT NULL DEFAULT '',
        job_description TEXT NOT NULL DEFAULT '',
        ats_keyword_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
        ats_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
        company_description TEXT NOT NULL DEFAULT '',
        recruiter_title TEXT NOT NULL DEFAULT '',
        email_draft TEXT NOT NULL DEFAULT '',
        job_poster_name TEXT NOT NULL DEFAULT '',
        job_poster_title TEXT NOT NULL DEFAULT '',
        company_domain TEXT NOT NULL DEFAULT '',
        company_intel JSONB,
        recruiter_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
        selected_recruiter_id TEXT NOT NULL DEFAULT '',
        outreach JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS jobs_posted_at_idx
      ON jobs (posted_at)
    `;
  })();

  return schemaReady;
}

function toRowData(job: JobListing) {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    jobType: job.jobType,
    source: job.source,
    postedAt: job.postedAt,
    scrapedAt: job.scrapedAt,
    applyUrl: job.applyUrl,
    status: job.status,
    atsScore: job.atsScore,
    recruiterName: job.recruiterName,
    recruiterEmail: job.recruiterEmail,
    recruiterProfileUrl: job.recruiterProfileUrl,
    jobDescription: job.jobDescription,
    atsKeywordGaps: JSON.stringify(job.atsKeywordGaps || []),
    atsSuggestions: JSON.stringify(job.atsSuggestions || []),
    companyDescription: job.companyDescription,
    recruiterTitle: job.recruiterTitle,
    emailDraft: job.emailDraft,
    jobPosterName: job.jobPosterName,
    jobPosterTitle: job.jobPosterTitle,
    companyDomain: job.companyDomain,
    companyIntel: job.companyIntel ? JSON.stringify(job.companyIntel) : null,
    recruiterCandidates: JSON.stringify(job.recruiterCandidates || []),
    selectedRecruiterId: job.selectedRecruiterId,
    outreach: JSON.stringify(job.outreach || {}),
  };
}

function fromRow(row: JobRow): JobListing {
  return normalizeJobListing({
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location,
    salary: row.salary,
    jobType: row.job_type,
    source: row.source === "indeed" ? "indeed" : row.source === "manual" ? "manual" : "linkedin",
    postedAt: row.posted_at,
    scrapedAt: row.scraped_at,
    applyUrl: row.apply_url,
    status: row.status,
    atsScore: typeof row.ats_score === "number" ? row.ats_score : null,
    recruiterName: row.recruiter_name,
    recruiterEmail: row.recruiter_email,
    recruiterProfileUrl: row.recruiter_profile_url,
    jobDescription: row.job_description,
    atsKeywordGaps: parseJson<string[]>(row.ats_keyword_gaps, []),
    atsSuggestions: parseJson<JobListing["atsSuggestions"]>(row.ats_suggestions, []),
    companyDescription: row.company_description,
    recruiterTitle: row.recruiter_title,
    emailDraft: row.email_draft,
    jobPosterName: row.job_poster_name,
    jobPosterTitle: row.job_poster_title,
    companyDomain: row.company_domain,
    companyIntel: parseJson<JobListing["companyIntel"]>(row.company_intel, null),
    recruiterCandidates: parseJson<JobListing["recruiterCandidates"]>(row.recruiter_candidates, []),
    selectedRecruiterId: row.selected_recruiter_id,
    outreach: parseJson<Record<string, unknown>>(row.outreach, {}),
  });
}

async function getJobById(sql: NeonQueryFunction<false, false>, id: string): Promise<JobListing | null> {
  const rows = (await sql`
    SELECT
      id,
      title,
      company,
      location,
      salary,
      job_type,
      source,
      posted_at,
      scraped_at,
      apply_url,
      status,
      ats_score,
      recruiter_name,
      recruiter_email,
      recruiter_profile_url,
      job_description,
      ats_keyword_gaps,
      ats_suggestions,
      company_description,
      recruiter_title,
      email_draft,
      job_poster_name,
      job_poster_title,
      company_domain,
      company_intel,
      recruiter_candidates,
      selected_recruiter_id,
      outreach
    FROM jobs
    WHERE id = ${id}
    LIMIT 1
  `) as JobRow[];

  if (!rows.length) return null;
  return fromRow(rows[0]);
}

async function upsertJob(sql: NeonQueryFunction<false, false>, job: JobListing) {
  const row = toRowData(job);
  await sql`
    INSERT INTO jobs (
      id,
      title,
      company,
      location,
      salary,
      job_type,
      source,
      posted_at,
      scraped_at,
      apply_url,
      status,
      ats_score,
      recruiter_name,
      recruiter_email,
      recruiter_profile_url,
      job_description,
      ats_keyword_gaps,
      ats_suggestions,
      company_description,
      recruiter_title,
      email_draft,
      job_poster_name,
      job_poster_title,
      company_domain,
      company_intel,
      recruiter_candidates,
      selected_recruiter_id,
      outreach,
      updated_at
    ) VALUES (
      ${row.id},
      ${row.title},
      ${row.company},
      ${row.location},
      ${row.salary},
      ${row.jobType},
      ${row.source},
      ${row.postedAt},
      ${row.scrapedAt},
      ${row.applyUrl},
      ${row.status},
      ${row.atsScore},
      ${row.recruiterName},
      ${row.recruiterEmail},
      ${row.recruiterProfileUrl},
      ${row.jobDescription},
      ${row.atsKeywordGaps}::jsonb,
      ${row.atsSuggestions}::jsonb,
      ${row.companyDescription},
      ${row.recruiterTitle},
      ${row.emailDraft},
      ${row.jobPosterName},
      ${row.jobPosterTitle},
      ${row.companyDomain},
      ${row.companyIntel}::jsonb,
      ${row.recruiterCandidates}::jsonb,
      ${row.selectedRecruiterId},
      ${row.outreach}::jsonb,
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      company = EXCLUDED.company,
      location = EXCLUDED.location,
      salary = EXCLUDED.salary,
      job_type = EXCLUDED.job_type,
      source = EXCLUDED.source,
      posted_at = EXCLUDED.posted_at,
      scraped_at = EXCLUDED.scraped_at,
      apply_url = EXCLUDED.apply_url,
      status = EXCLUDED.status,
      ats_score = EXCLUDED.ats_score,
      recruiter_name = EXCLUDED.recruiter_name,
      recruiter_email = EXCLUDED.recruiter_email,
      recruiter_profile_url = EXCLUDED.recruiter_profile_url,
      job_description = EXCLUDED.job_description,
      ats_keyword_gaps = EXCLUDED.ats_keyword_gaps,
      ats_suggestions = EXCLUDED.ats_suggestions,
      company_description = EXCLUDED.company_description,
      recruiter_title = EXCLUDED.recruiter_title,
      email_draft = EXCLUDED.email_draft,
      job_poster_name = EXCLUDED.job_poster_name,
      job_poster_title = EXCLUDED.job_poster_title,
      company_domain = EXCLUDED.company_domain,
      company_intel = EXCLUDED.company_intel,
      recruiter_candidates = EXCLUDED.recruiter_candidates,
      selected_recruiter_id = EXCLUDED.selected_recruiter_id,
      outreach = EXCLUDED.outreach,
      updated_at = NOW()
  `;
}

export async function getAllJobsFromPostgres(): Promise<JobListing[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = (await sql`
    SELECT
      id,
      title,
      company,
      location,
      salary,
      job_type,
      source,
      posted_at,
      scraped_at,
      apply_url,
      status,
      ats_score,
      recruiter_name,
      recruiter_email,
      recruiter_profile_url,
      job_description,
      ats_keyword_gaps,
      ats_suggestions,
      company_description,
      recruiter_title,
      email_draft,
      job_poster_name,
      job_poster_title,
      company_domain,
      company_intel,
      recruiter_candidates,
      selected_recruiter_id,
      outreach
    FROM jobs
    ORDER BY created_at DESC
  `) as JobRow[];

  return rows.map(fromRow);
}

export async function appendJobsToPostgres(jobs: JobListing[]): Promise<JobListing[]> {
  await ensureSchema();
  if (!jobs.length) return [];
  const sql = getSql();

  const inserted: JobListing[] = [];
  for (const input of jobs) {
    const normalized = normalizeJobListing(input);
    if (!normalized.id) {
      continue;
    }
    const result = await sql`
      INSERT INTO jobs (
        id,
        title,
        company,
        location,
        salary,
        job_type,
        source,
        posted_at,
        scraped_at,
        apply_url,
        status,
        ats_score,
        recruiter_name,
        recruiter_email,
        recruiter_profile_url,
        job_description,
        ats_keyword_gaps,
        ats_suggestions,
        company_description,
        recruiter_title,
        email_draft,
        job_poster_name,
        job_poster_title,
        company_domain,
        company_intel,
        recruiter_candidates,
        selected_recruiter_id,
        outreach
      ) VALUES (
        ${normalized.id},
        ${normalized.title},
        ${normalized.company},
        ${normalized.location},
        ${normalized.salary},
        ${normalized.jobType},
        ${normalized.source},
        ${normalized.postedAt},
        ${normalized.scrapedAt},
        ${normalized.applyUrl},
        ${normalized.status},
        ${normalized.atsScore},
        ${normalized.recruiterName},
        ${normalized.recruiterEmail},
        ${normalized.recruiterProfileUrl},
        ${normalized.jobDescription},
        ${JSON.stringify(normalized.atsKeywordGaps || [])}::jsonb,
        ${JSON.stringify(normalized.atsSuggestions || [])}::jsonb,
        ${normalized.companyDescription},
        ${normalized.recruiterTitle},
        ${normalized.emailDraft},
        ${normalized.jobPosterName},
        ${normalized.jobPosterTitle},
        ${normalized.companyDomain},
        ${normalized.companyIntel ? JSON.stringify(normalized.companyIntel) : null}::jsonb,
        ${JSON.stringify(normalized.recruiterCandidates || [])}::jsonb,
        ${normalized.selectedRecruiterId},
        ${JSON.stringify(normalized.outreach || {})}::jsonb
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;

    if (result.length > 0) {
      inserted.push(normalized);
    }
  }

  return inserted;
}

export async function updateJobInPostgres(id: string, updates: Partial<JobListing>): Promise<void> {
  await ensureSchema();
  if (!id) return;
  const sql = getSql();
  const existing = await getJobById(sql, id);
  if (!existing) return;

  const merged = normalizeJobListing({ ...existing, ...updates, id });
  await upsertJob(sql, merged);
}

export async function deleteJobFromPostgres(id: string): Promise<void> {
  await ensureSchema();
  if (!id) return;
  const sql = getSql();
  await sql`DELETE FROM jobs WHERE id = ${id}`;
}
