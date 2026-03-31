import { JobListing } from "@/types";
import { appendJobsToDb, deleteJobFromDb, getAllJobsFromDb, updateJobInDb } from "./jobs-db";
import { getConfig } from "./local-store";
import { appendJobs as appendJobsToSheets, deleteJob as deleteJobFromSheets, getAllJobs as getAllJobsFromSheets, updateJob as updateJobInSheets } from "./sheets";

type JobStoreMode = "local" | "sheets" | "hybrid";

function hasSheetsConfigured() {
  const config = getConfig();
  return Boolean(config.apiKeys.googleSheetsId && config.apiKeys.googleServiceAccount);
}

function getStoreMode(): JobStoreMode {
  const envValue = (process.env.JOB_STORE_MODE || "").toLowerCase();
  if (envValue === "local" || envValue === "sheets" || envValue === "hybrid") {
    return envValue;
  }

  const configValue = getConfig().jobStoreMode;
  if (configValue === "local" || configValue === "sheets" || configValue === "hybrid") {
    return configValue;
  }

  return "local";
}

export async function getAllJobs(): Promise<JobListing[]> {
  const mode = getStoreMode();

  if (mode === "sheets") {
    if (!hasSheetsConfigured()) {
      return getAllJobsFromDb();
    }
    return getAllJobsFromSheets();
  }

  if (mode === "hybrid") {
    const localJobs = await getAllJobsFromDb();
    if (localJobs.length > 0) {
      return localJobs;
    }

    if (hasSheetsConfigured()) {
      const sheetJobs = await getAllJobsFromSheets();
      if (sheetJobs.length > 0) {
        await appendJobsToDb(sheetJobs);
      }
      return sheetJobs;
    }

    return localJobs;
  }

  return getAllJobsFromDb();
}

export async function appendJobs(jobs: JobListing[]): Promise<JobListing[]> {
  const mode = getStoreMode();

  if (mode === "sheets") {
    if (!hasSheetsConfigured()) {
      return appendJobsToDb(jobs);
    }
    return appendJobsToSheets(jobs);
  }

  if (mode === "hybrid") {
    const localInserted = await appendJobsToDb(jobs);
    if (hasSheetsConfigured()) {
      try {
        await appendJobsToSheets(localInserted);
      } catch (error) {
        console.warn("Sheets append failed in hybrid mode:", error);
      }
    }
    return localInserted;
  }

  return appendJobsToDb(jobs);
}

export async function updateJob(id: string, updates: Partial<JobListing>): Promise<void> {
  const mode = getStoreMode();

  if (mode === "sheets") {
    if (!hasSheetsConfigured()) {
      await updateJobInDb(id, updates);
      return;
    }
    await updateJobInSheets(id, updates);
    return;
  }

  if (mode === "hybrid") {
    await updateJobInDb(id, updates);
    if (hasSheetsConfigured()) {
      try {
        await updateJobInSheets(id, updates);
      } catch (error) {
        console.warn("Sheets update failed in hybrid mode:", error);
      }
    }
    return;
  }

  await updateJobInDb(id, updates);
}

export async function deleteJob(id: string): Promise<void> {
  const mode = getStoreMode();

  if (mode === "sheets") {
    if (!hasSheetsConfigured()) {
      await deleteJobFromDb(id);
      return;
    }
    await deleteJobFromSheets(id);
    return;
  }

  if (mode === "hybrid") {
    await deleteJobFromDb(id);
    if (hasSheetsConfigured()) {
      try {
        await deleteJobFromSheets(id);
      } catch (error) {
        console.warn("Sheets delete failed in hybrid mode:", error);
      }
    }
    return;
  }

  await deleteJobFromDb(id);
}
