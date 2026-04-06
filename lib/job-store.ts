import { JobListing } from "@/types";
import { appendJobsToDb, deleteJobFromDb, getAllJobsFromDb, updateJobInDb } from "./jobs-db";
import { getConfig } from "./local-store";
import {
  appendJobsToPostgres,
  deleteJobFromPostgres,
  getAllJobsFromPostgres,
  hasPostgresConfigured,
  updateJobInPostgres,
} from "./postgres";

type JobStoreMode = "local" | "postgres";

let warnedMissingPostgres = false;

function normalizeStoreMode(value: unknown): JobStoreMode {
  if (value === "local") return "local";
  if (value === "postgres" || value === "sheets" || value === "hybrid") return "postgres";
  return "postgres";
}

function getStoreMode(): JobStoreMode {
  const envValue = normalizeStoreMode((process.env.JOB_STORE_MODE || "").toLowerCase());
  if (process.env.JOB_STORE_MODE) {
    if (envValue === "postgres" && !hasPostgresConfigured()) {
      if (!warnedMissingPostgres) {
        console.warn("JOB_STORE_MODE=postgres but DATABASE_URL/POSTGRES_URL is missing. Falling back to local file storage.");
        warnedMissingPostgres = true;
      }
      return "local";
    }
    return envValue;
  }

  if (hasPostgresConfigured()) {
    return "postgres";
  }

  const configValue = normalizeStoreMode(getConfig().jobStoreMode);
  if (configValue === "postgres") {
    if (!warnedMissingPostgres) {
      console.warn("Configured for postgres but DATABASE_URL/POSTGRES_URL is missing. Falling back to local file storage.");
      warnedMissingPostgres = true;
    }
    return "local";
  }

  return configValue;
}

export async function getAllJobs(): Promise<JobListing[]> {
  const mode = getStoreMode();

  if (mode === "postgres") {
    return getAllJobsFromPostgres();
  }

  return getAllJobsFromDb();
}

export async function appendJobs(jobs: JobListing[]): Promise<JobListing[]> {
  const mode = getStoreMode();

  if (mode === "postgres") {
    return appendJobsToPostgres(jobs);
  }

  return appendJobsToDb(jobs);
}

export async function updateJob(id: string, updates: Partial<JobListing>): Promise<void> {
  const mode = getStoreMode();

  if (mode === "postgres") {
    await updateJobInPostgres(id, updates);
    return;
  }

  await updateJobInDb(id, updates);
}

export async function deleteJob(id: string): Promise<void> {
  const mode = getStoreMode();

  if (mode === "postgres") {
    await deleteJobFromPostgres(id);
    return;
  }

  await deleteJobFromDb(id);
}
