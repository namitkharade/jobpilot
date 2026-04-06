import fs from "fs";
import path from "path";

import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
if (!connectionString) {
  throw new Error("Missing DATABASE_URL or POSTGRES_URL. Set it in .env.local or your shell before running migration.");
}

const sql = neon(connectionString);
const jobsDbPath = path.join(process.cwd(), "jobs-db.json");

function readLocalJobs() {
  if (!fs.existsSync(jobsDbPath)) {
    throw new Error(`Local jobs DB not found at ${jobsDbPath}`);
  }

  const raw = fs.readFileSync(jobsDbPath, "utf8");
  const parsed = raw.trim() ? JSON.parse(raw) : { jobs: [] };
  if (!Array.isArray(parsed.jobs)) {
    return [];
  }
  return parsed.jobs;
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function asJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed);
    } catch {
      return fallback;
    }
  }
  return value;
}

function asIntOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeJob(raw) {
  return {
    id: asString(raw.id),
    title: asString(raw.title),
    company: asString(raw.company),
    location: asString(raw.location),
    salary: asString(raw.salary),
    jobType: asString(raw.jobType),
    source: asString(raw.source) === "indeed" ? "indeed" : "linkedin",
    postedAt: asString(raw.postedAt),
    scrapedAt: asString(raw.scrapedAt),
    applyUrl: asString(raw.applyUrl),
    status: asString(raw.status) || "saved",
    atsScore: asIntOrNull(raw.atsScore),
    recruiterName: asString(raw.recruiterName),
    recruiterEmail: asString(raw.recruiterEmail),
    recruiterProfileUrl: asString(raw.recruiterProfileUrl),
    jobDescription: asString(raw.jobDescription),
    atsKeywordGaps: Array.isArray(asJson(raw.atsKeywordGaps, [])) ? asJson(raw.atsKeywordGaps, []) : [],
    atsSuggestions: Array.isArray(asJson(raw.atsSuggestions, [])) ? asJson(raw.atsSuggestions, []) : [],
    companyDescription: asString(raw.companyDescription),
    recruiterTitle: asString(raw.recruiterTitle),
    emailDraft: asString(raw.emailDraft),
    jobPosterName: asString(raw.jobPosterName),
    jobPosterTitle: asString(raw.jobPosterTitle),
    companyDomain: asString(raw.companyDomain),
    companyIntel: asJson(raw.companyIntel, null),
    recruiterCandidates: Array.isArray(asJson(raw.recruiterCandidates, [])) ? asJson(raw.recruiterCandidates, []) : [],
    selectedRecruiterId: asString(raw.selectedRecruiterId),
    outreach: asJson(raw.outreach, {}),
  };
}

async function ensureSchema() {
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
}

async function upsertJob(job) {
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
      ${job.id},
      ${job.title},
      ${job.company},
      ${job.location},
      ${job.salary},
      ${job.jobType},
      ${job.source},
      ${job.postedAt},
      ${job.scrapedAt},
      ${job.applyUrl},
      ${job.status},
      ${job.atsScore},
      ${job.recruiterName},
      ${job.recruiterEmail},
      ${job.recruiterProfileUrl},
      ${job.jobDescription},
      ${JSON.stringify(job.atsKeywordGaps || [])}::jsonb,
      ${JSON.stringify(job.atsSuggestions || [])}::jsonb,
      ${job.companyDescription},
      ${job.recruiterTitle},
      ${job.emailDraft},
      ${job.jobPosterName},
      ${job.jobPosterTitle},
      ${job.companyDomain},
      ${job.companyIntel ? JSON.stringify(job.companyIntel) : null}::jsonb,
      ${JSON.stringify(job.recruiterCandidates || [])}::jsonb,
      ${job.selectedRecruiterId},
      ${JSON.stringify(job.outreach || {})}::jsonb,
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

async function main() {
  const jobs = readLocalJobs()
    .map(normalizeJob)
    .filter((job) => job.id);

  await ensureSchema();

  for (const job of jobs) {
    await upsertJob(job);
  }

  console.log(`Migrated ${jobs.length} jobs from local jobs-db.json to Postgres.`);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
