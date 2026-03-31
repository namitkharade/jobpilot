import { JobListing, JobSource, JobStatus } from "@/types";
import type { sheets_v4 } from "googleapis";
import { google } from "googleapis";
import { normalizeJobListing } from "./job-normalize";
import { getConfig } from "./local-store";

function getGoogleConfig() {
  const config = getConfig();
  return {
    serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || config.apiKeys.googleServiceAccount,
    sheetsId: process.env.GOOGLE_SHEETS_ID || config.apiKeys.googleSheetsId,
  };
}

// Keep historical ordering to avoid breaking existing sheets; new fields are appended.
const CANONICAL_HEADERS = [
  "id",
  "title",
  "company",
  "location",
  "salary",
  "jobType",
  "source",
  "postedAt",
  "scrapedAt",
  "applyUrl",
  "status",
  "atsScore",
  "recruiterName",
  "recruiterEmail",
  "recruiterProfileUrl",
  "jobDescription",
  "atsKeywordGaps",
  "atsSuggestions",
  "companyDescription",
  "recruiterTitle",
  "emailDraft",
  "jobPosterName",
  "jobPosterTitle",
] as const;

const SHEETS_SCOPE = ["https://www.googleapis.com/auth/spreadsheets"];

type HeaderMap = Record<string, number>;

let authInstance: InstanceType<typeof google.auth.GoogleAuth> | null = null;
let authCredentialHash = "";

async function getAuth() {
  const { serviceAccount } = getGoogleConfig();
  if (!serviceAccount) {
    throw new Error("Google Service Account JSON is missing from environment and configuration.");
  }

  const credentialHash = serviceAccount.slice(-20);

  if (!authInstance || authCredentialHash !== credentialHash) {
    const credentials = JSON.parse(serviceAccount);
    authInstance = new google.auth.GoogleAuth({
      credentials,
      scopes: SHEETS_SCOPE,
    });
    authCredentialHash = credentialHash;
  }

  return authInstance;
}

async function getSheets(): Promise<sheets_v4.Sheets> {
  const auth = await getAuth();
  return google.sheets({ version: "v4", auth });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((res) => setTimeout(res, Math.pow(2, i) * 1000));
    }
  }
  throw new Error("Unreachable");
}

function toColumnName(index: number): string {
  let n = index;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function getHeaderMap(headers: string[]): HeaderMap {
  return headers.reduce<HeaderMap>((acc, header, index) => {
    if (header) acc[header] = index;
    return acc;
  }, {});
}

function getCell(row: string[], map: HeaderMap, keys: string[], fallbackIndex: number): string {
  for (const key of keys) {
    const index = map[key];
    if (typeof index === "number") {
      return row[index] || "";
    }
  }
  return row[fallbackIndex] || "";
}

function buildRow(job: JobListing, headers: string[]): string[] {
  const row = new Array(headers.length).fill("");

  headers.forEach((header, index) => {
    switch (header) {
      case "id":
        row[index] = job.id;
        break;
      case "title":
        row[index] = job.title;
        break;
      case "company":
        row[index] = job.company;
        break;
      case "location":
        row[index] = job.location;
        break;
      case "salary":
        row[index] = job.salary;
        break;
      case "jobType":
        row[index] = job.jobType;
        break;
      case "source":
        row[index] = job.source;
        break;
      case "postedAt":
        row[index] = job.postedAt;
        break;
      case "scrapedAt":
        row[index] = job.scrapedAt;
        break;
      case "applyUrl":
        row[index] = job.applyUrl;
        break;
      case "status":
        row[index] = job.status;
        break;
      case "atsScore":
        row[index] = job.atsScore !== null ? String(job.atsScore) : "";
        break;
      case "recruiterName":
        row[index] = job.recruiterName;
        break;
      case "recruiterEmail":
        row[index] = job.recruiterEmail;
        break;
      case "recruiterProfileUrl":
        row[index] = job.recruiterProfileUrl;
        break;
      case "jobDescription":
        row[index] = job.jobDescription;
        break;
      case "atsKeywordGaps":
        row[index] = Array.isArray(job.atsKeywordGaps) ? job.atsKeywordGaps.join(",") : "";
        break;
      case "atsSuggestions":
        row[index] = Array.isArray(job.atsSuggestions) ? JSON.stringify(job.atsSuggestions) : "";
        break;
      case "companyDescription":
        row[index] = job.companyDescription;
        break;
      case "recruiterTitle":
        row[index] = job.recruiterTitle;
        break;
      case "emailDraft":
        row[index] = job.emailDraft;
        break;
      case "jobPosterName":
        row[index] = job.jobPosterName;
        break;
      case "jobPosterTitle":
        row[index] = job.jobPosterTitle;
        break;
      default:
        row[index] = "";
    }
  });

  return row;
}

async function ensureHeaders(sheets: sheets_v4.Sheets): Promise<{ headers: string[]; map: HeaderMap }> {
  const { sheetsId } = getGoogleConfig();
  if (!sheetsId) throw new Error("Google Sheets ID is missing.");

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsId,
    range: "A1:ZZ1",
  });

  const current = (headerResponse.data.values?.[0] || []).map((entry) => String(entry || "").trim());
  let headers: string[];

  if (!current.length) {
    headers = [...CANONICAL_HEADERS];
  } else {
    headers = [...current];
    for (const required of CANONICAL_HEADERS) {
      if (!headers.includes(required)) {
        headers.push(required);
      }
    }
  }

  const shouldWrite =
    !current.length ||
    current.length !== headers.length ||
    headers.some((header, index) => current[index] !== header);

  if (shouldWrite) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range: `A1:${toColumnName(headers.length)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  return { headers, map: getHeaderMap(headers) };
}

function parseJobFromRow(row: string[], map: HeaderMap): JobListing | null {
  const id = getCell(row, map, ["id"], 0);
  const title = getCell(row, map, ["title"], 1);
  const company = getCell(row, map, ["company"], 2);

  if (!id && !title && !company) return null;

  const atsSuggestionsRaw = getCell(row, map, ["atsSuggestions"], 17);
  const atsSuggestions = atsSuggestionsRaw
    ? (() => {
        try {
          const parsed = JSON.parse(atsSuggestionsRaw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
    : [];

  return normalizeJobListing({
    id,
    title,
    company,
    location: getCell(row, map, ["location"], 3),
    salary: getCell(row, map, ["salary"], 4),
    jobType: getCell(row, map, ["jobType"], 5),
    source: (getCell(row, map, ["source"], 6) as JobSource) || "linkedin",
    postedAt: getCell(row, map, ["postedAt"], 7),
    scrapedAt: getCell(row, map, ["scrapedAt"], 8),
    applyUrl: getCell(row, map, ["applyUrl"], 9),
    status: (getCell(row, map, ["status"], 10) as JobStatus) || "saved",
    atsScore: (() => {
      const raw = getCell(row, map, ["atsScore"], 11);
      if (!raw) return null;
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? null : parsed;
    })(),
    recruiterName: getCell(row, map, ["recruiterName"], 12),
    recruiterEmail: getCell(row, map, ["recruiterEmail"], 13),
    recruiterProfileUrl: getCell(row, map, ["recruiterProfileUrl"], 14),
    jobDescription: getCell(row, map, ["jobDescription", "descriptionText", "description"], 15),
    atsKeywordGaps: getCell(row, map, ["atsKeywordGaps"], 16)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    atsSuggestions,
    companyDescription: getCell(row, map, ["companyDescription"], 18),
    recruiterTitle: getCell(row, map, ["recruiterTitle"], 19),
    emailDraft: getCell(row, map, ["emailDraft"], 20),
    jobPosterName: getCell(row, map, ["jobPosterName"], 21),
    jobPosterTitle: getCell(row, map, ["jobPosterTitle"], 22),
  });
}

export async function appendJobs(jobs: JobListing[]): Promise<JobListing[]> {
  const { sheetsId } = getGoogleConfig();
  if (!sheetsId) {
    return [];
  }
  if (!jobs.length) return [];

  const sheets = await withRetry(getSheets);
  const { headers, map } = await withRetry(() => ensureHeaders(sheets));

  let existingValues: sheets_v4.Schema$ValueRange | null = null;
  try {
    const idColumn = toColumnName((map.id ?? 0) + 1);
    const existingValuesResponse = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetsId,
        range: `${idColumn}:${idColumn}`,
      })
    );
    existingValues = existingValuesResponse.data;
  } catch {
    existingValues = { values: [] };
  }

  const existingIds = new Set<string>();
  const rows = Array.isArray(existingValues.values) ? existingValues.values : [];
  for (const row of rows) {
    const idValue = row?.[0];
    if (typeof idValue === "string" && idValue) {
      existingIds.add(idValue);
    }
  }

  const newJobs = jobs
    .map((job) => normalizeJobListing(job))
    .filter((job) => job.id && !existingIds.has(job.id));

  if (!newJobs.length) return [];

  const values = newJobs.map((job) => buildRow(job, headers));

  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: sheetsId,
      range: `A:${toColumnName(headers.length)}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    })
  );

  return newJobs;
}

export async function getAllJobs(): Promise<JobListing[]> {
  const { sheetsId } = getGoogleConfig();
  if (!sheetsId) return [];

  const sheets = await withRetry(getSheets);
  const { map } = await withRetry(() => ensureHeaders(sheets));

  let response: sheets_v4.Schema$ValueRange;
  try {
    const result = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId: sheetsId,
        range: "A:ZZ",
      })
    );
    response = result.data;
  } catch {
    return [];
  }

  const rows = Array.isArray(response.values) ? (response.values as string[][]) : [];
  if (rows.length <= 1) return [];

  const jobs: JobListing[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const parsed = parseJobFromRow(row, map);
    if (parsed) jobs.push(parsed);
  }

  return jobs;
}

export async function updateJob(id: string, updates: Partial<JobListing>) {
  const { sheetsId } = getGoogleConfig();
  if (!sheetsId || !id) return;

  const sheets = await withRetry(getSheets);
  const { headers, map } = await withRetry(() => ensureHeaders(sheets));

  const response = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range: "A:ZZ",
    })
  );

  const rows = Array.isArray(response.data.values) ? (response.data.values as string[][]) : [];
  if (rows.length <= 1) return;

  const idIndex = map.id ?? 0;
  const rowIndex = rows.findIndex((row, index) => index > 0 && (row[idIndex] || "") === id);
  if (rowIndex === -1) return;

  const existing = parseJobFromRow(rows[rowIndex], map);
  if (!existing) return;

  const merged = normalizeJobListing({ ...existing, ...updates, id });
  const newRow = buildRow(merged, headers);

  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range: `A${rowIndex + 1}:${toColumnName(headers.length)}${rowIndex + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [newRow] },
    })
  );
}

export async function deleteJob(id: string): Promise<void> {
  const { sheetsId } = getGoogleConfig();
  if (!sheetsId || !id) return;

  const sheets = await getSheets();
  const { map } = await ensureHeaders(sheets);
  const idColumn = toColumnName((map.id ?? 0) + 1);

  const response = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: sheetsId,
      range: `${idColumn}:${idColumn}`,
    })
  );

  const rows = response.data.values || [];
  const rowIndex = rows.findIndex((row: string[]) => row[0] === id);
  if (rowIndex === -1) return;

  await withRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetsId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: "ROWS",
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      },
    })
  );
}
