import { JobListing } from "@/types";
import fs from "fs";
import path from "path";
import { normalizeJobListing } from "./job-normalize";

interface JobsDbFile {
  jobs: JobListing[];
}

const JOBS_DB_PATH = path.join(process.cwd(), "jobs-db.json");

function readDb(): JobsDbFile {
  try {
    if (!fs.existsSync(JOBS_DB_PATH)) {
      const initial: JobsDbFile = { jobs: [] };
      fs.writeFileSync(JOBS_DB_PATH, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    const raw = fs.readFileSync(JOBS_DB_PATH, "utf8");
    if (!raw.trim()) {
      return { jobs: [] };
    }

    const parsed = JSON.parse(raw) as Partial<JobsDbFile>;
    const jobs = Array.isArray(parsed.jobs)
      ? parsed.jobs.map((job) => normalizeJobListing(job))
      : [];

    return { jobs };
  } catch {
    return { jobs: [] };
  }
}

function writeDb(db: JobsDbFile) {
  fs.writeFileSync(JOBS_DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

export async function getAllJobsFromDb(): Promise<JobListing[]> {
  return readDb().jobs;
}

export async function appendJobsToDb(jobs: JobListing[]): Promise<JobListing[]> {
  if (!jobs.length) return [];

  const db = readDb();
  const existingIds = new Set(db.jobs.map((job) => job.id));
  const toAdd = jobs
    .map((job) => normalizeJobListing(job))
    .filter((job) => job.id && !existingIds.has(job.id));

  if (!toAdd.length) return [];

  db.jobs.push(...toAdd);
  writeDb(db);
  return toAdd;
}

export async function updateJobInDb(id: string, updates: Partial<JobListing>): Promise<void> {
  if (!id) return;

  const db = readDb();
  const index = db.jobs.findIndex((job) => job.id === id);
  if (index === -1) return;

  db.jobs[index] = normalizeJobListing({ ...db.jobs[index], ...updates, id });
  writeDb(db);
}

export async function deleteJobFromDb(id: string): Promise<void> {
  if (!id) return;
  const db = readDb();
  const next = db.jobs.filter((job) => job.id !== id);
  if (next.length === db.jobs.length) return;
  writeDb({ jobs: next });
}
