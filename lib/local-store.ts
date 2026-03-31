import fs from "fs";
import path from "path";

export interface AppConfig {
  defaultQuery: string;
  defaultLocation: string;
  jobStoreMode: "local" | "sheets" | "hybrid";
  cronEnabled: boolean;
  lastCronRunAt: string | null;
  lastCronResult: "success" | "error" | "skipped" | null;
  apiKeys: {
    apify: string;
    hunter: string;
    openai: string;
    searxng: string;
    googleSheetsId: string;
    googleServiceAccount: string;
    cronSecret: string;
    gmailClientId: string;
    gmailClientSecret: string;
  };
}

export interface CronRunLog {
  id: string;
  runAt: string;
  status: "success" | "error" | "skipped";
  scraped: number;
  newJobs: number;
  atsTriggered: number;
  message: string;
  errors: string[];
}

function getWritableDataPath(fileName: string): string {
  if (process.env.VERCEL === "1") {
    return path.join("/tmp", fileName);
  }
  return path.join(process.cwd(), fileName);
}

const CONFIG_PATH = getWritableDataPath("config.json");
const LOGS_PATH = getWritableDataPath("logs.json");

function sanitizeSecret(value: unknown): string {
  if (typeof value !== "string") return "";
  // Remove control characters that can break HTTP headers and auth tokens.
  return value.replace(/[\r\n\t]/g, "").trim();
}

const DEFAULT_CONFIG: AppConfig = {
  defaultQuery: "Software Engineer",
  defaultLocation: "Remote",
  jobStoreMode: "local",
  cronEnabled: true,
  lastCronRunAt: null,
  lastCronResult: null,
  apiKeys: {
    apify: "",
    hunter: "",
    openai: "",
    searxng: "",
    googleSheetsId: "",
    googleServiceAccount: "",
    cronSecret: "",
    gmailClientId: "",
    gmailClientSecret: "",
  },
};

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
      return fallback;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
      return fallback;
    }

    const parsed = JSON.parse(raw) as T;
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJsonFile<T>(filePath: string, value: T) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function normalizeJobStoreMode(value: unknown): AppConfig["jobStoreMode"] {
  if (value === "local" || value === "sheets" || value === "hybrid") {
    return value;
  }
  return "local";
}

function inferDefaultJobStoreMode(config: Pick<AppConfig, "apiKeys">): AppConfig["jobStoreMode"] {
  const hasSheets = Boolean(config.apiKeys.googleSheetsId && config.apiKeys.googleServiceAccount);
  if (process.env.VERCEL === "1" && hasSheets) {
    return "sheets";
  }
  return "local";
}

export function getConfig(): AppConfig {
  const loaded = readJsonFile<AppConfig>(CONFIG_PATH, DEFAULT_CONFIG);
  const envMode = process.env.JOB_STORE_MODE;
  const loadedMode = loaded.jobStoreMode;
  const mergedApiKeys: AppConfig["apiKeys"] = {
    ...DEFAULT_CONFIG.apiKeys,
    ...(loaded.apiKeys || {}),
    // Priorities go to environment variables first, then JSON structure
    apify: sanitizeSecret(process.env.APIFY_API_TOKEN || loaded.apiKeys?.apify || ""),
    hunter: sanitizeSecret(process.env.HUNTER_API_KEY || loaded.apiKeys?.hunter || ""),
    openai: sanitizeSecret(process.env.OPENAI_API_KEY || loaded.apiKeys?.openai || ""),
    searxng: sanitizeSecret(process.env.SEARXNG_URL || loaded.apiKeys?.searxng || ""),
    googleSheetsId: sanitizeSecret(process.env.GOOGLE_SHEETS_ID || loaded.apiKeys?.googleSheetsId || ""),
    googleServiceAccount: sanitizeSecret(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || loaded.apiKeys?.googleServiceAccount || ""),
    cronSecret: sanitizeSecret(process.env.CRON_SECRET || loaded.apiKeys?.cronSecret || ""),
    gmailClientId: sanitizeSecret(process.env.GMAIL_CLIENT_ID || loaded.apiKeys?.gmailClientId || ""),
    gmailClientSecret: sanitizeSecret(process.env.GMAIL_CLIENT_SECRET || loaded.apiKeys?.gmailClientSecret || ""),
  };

  const resolvedMode = envMode
    ? normalizeJobStoreMode(envMode)
    : loadedMode
      ? normalizeJobStoreMode(loadedMode)
      : inferDefaultJobStoreMode({ apiKeys: mergedApiKeys });
  
  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    ...loaded,
    jobStoreMode: resolvedMode,
    apiKeys: mergedApiKeys,
  };

  return merged;
}

export function saveConfig(next: Partial<AppConfig>) {
  const current = getConfig();
  const nextApiKeys: Partial<AppConfig["apiKeys"]> = next.apiKeys || {};
  const merged: AppConfig = {
    ...current,
    ...next,
    jobStoreMode: normalizeJobStoreMode(next.jobStoreMode ?? current.jobStoreMode),
    apiKeys: {
      ...current.apiKeys,
      ...nextApiKeys,
      apify: sanitizeSecret(nextApiKeys.apify ?? current.apiKeys.apify),
      hunter: sanitizeSecret(nextApiKeys.hunter ?? current.apiKeys.hunter),
      openai: sanitizeSecret(nextApiKeys.openai ?? current.apiKeys.openai),
      searxng: sanitizeSecret(nextApiKeys.searxng ?? current.apiKeys.searxng),
      googleSheetsId: sanitizeSecret(nextApiKeys.googleSheetsId ?? current.apiKeys.googleSheetsId),
      googleServiceAccount: sanitizeSecret(nextApiKeys.googleServiceAccount ?? current.apiKeys.googleServiceAccount),
      cronSecret: sanitizeSecret(nextApiKeys.cronSecret ?? current.apiKeys.cronSecret),
      gmailClientId: sanitizeSecret(nextApiKeys.gmailClientId ?? current.apiKeys.gmailClientId),
      gmailClientSecret: sanitizeSecret(nextApiKeys.gmailClientSecret ?? current.apiKeys.gmailClientSecret),
    },
  };

  // When saving, we don't want to persist API keys that were pulled from process.env
  // So we create a version without some keys if they are redundant with ENV.
  const persistableKeys: AppConfig["apiKeys"] = {
    apify: process.env.APIFY_API_TOKEN ? "" : merged.apiKeys.apify,
    hunter: process.env.HUNTER_API_KEY ? "" : merged.apiKeys.hunter,
    openai: process.env.OPENAI_API_KEY ? "" : merged.apiKeys.openai,
    searxng: process.env.SEARXNG_URL ? "" : merged.apiKeys.searxng,
    googleSheetsId: process.env.GOOGLE_SHEETS_ID ? "" : merged.apiKeys.googleSheetsId,
    googleServiceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "" : merged.apiKeys.googleServiceAccount,
    cronSecret: process.env.CRON_SECRET ? "" : merged.apiKeys.cronSecret,
    gmailClientId: process.env.GMAIL_CLIENT_ID ? "" : merged.apiKeys.gmailClientId,
    gmailClientSecret: process.env.GMAIL_CLIENT_SECRET ? "" : merged.apiKeys.gmailClientSecret,
  };

  writeJsonFile(CONFIG_PATH, { ...merged, apiKeys: persistableKeys });
  return merged;
}

export function getCronLogs(): CronRunLog[] {
  const logs = readJsonFile<CronRunLog[]>(LOGS_PATH, []);
  return Array.isArray(logs) ? logs : [];
}

export function appendCronLog(log: Omit<CronRunLog, "id">): CronRunLog {
  const logs = getCronLogs();
  const entry: CronRunLog = {
    id: `cron_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ...log,
  };

  const next = [entry, ...logs].slice(0, 200);
  writeJsonFile(LOGS_PATH, next);
  return entry;
}

export function getLast7DaysLogs() {
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  return getCronLogs().filter((log) => {
    const runAtMs = new Date(log.runAt).getTime();
    if (Number.isNaN(runAtMs)) return false;
    return now - runAtMs <= sevenDaysMs;
  });
}

export function maskSecret(secret: string) {
  if (!secret) return "";
  if (secret.length <= 4) return "*".repeat(secret.length);
  return `${"*".repeat(Math.max(secret.length - 4, 0))}${secret.slice(-4)}`;
}
