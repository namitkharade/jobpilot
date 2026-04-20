import { appendCronLog, getConfig, saveConfig } from "@/lib/local-store";
import { getResumeDocumentStatus } from "@/lib/openai";
import { JobListing } from "@/types";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json()) as T;
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

export async function GET() {
  const config = getConfig();
  const secret = process.env.CRON_SECRET || config.apiKeys.cronSecret;
  if (process.env.NODE_ENV === "production" && !secret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET must be configured in production" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      cronEnabled: config.cronEnabled,
      defaultQuery: config.defaultQuery,
      defaultLocation: config.defaultLocation,
      lastCronRunAt: config.lastCronRunAt,
      lastCronResult: config.lastCronResult,
    },
  });
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const config = getConfig();
  const secret = process.env.CRON_SECRET || config.apiKeys.cronSecret;

  if (process.env.NODE_ENV === "production" && !secret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET must be configured in production" },
      { status: 503 }
    );
  }

  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runAt = new Date().toISOString();

  if (!config.cronEnabled) {
    const log = appendCronLog({
      runAt,
      status: "skipped",
      scraped: 0,
      newJobs: 0,
      atsTriggered: 0,
      message: "Cron is disabled in settings",
      errors: [],
    });

    saveConfig({ lastCronRunAt: runAt, lastCronResult: "skipped" });

    return NextResponse.json({ success: true, data: log });
  }

  try {
    const baseUrl = new URL(req.url).origin;

    const beforeJobsRes = await fetchJson<{ success: boolean; data: JobListing[] }>(`${baseUrl}/api/jobs`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const beforeIds = new Set((beforeJobsRes.data || []).map((job) => job.id));

    const scrapeRes = await fetchJson<{ scraped?: number; newJobs?: number; duplicates?: number; error?: string }>(`${baseUrl}/api/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: config.defaultQuery,
        location: config.defaultLocation,
      }),
      cache: "no-store",
    });

    const afterJobsRes = await fetchJson<{ success: boolean; data: JobListing[] }>(`${baseUrl}/api/jobs`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    const newJobs = (afterJobsRes.data || []).filter((job) => !beforeIds.has(job.id));
    const resumeStatus = getResumeDocumentStatus();

    let atsTriggered = 0;
    const atsErrors: string[] = [];

    if (resumeStatus.loaded) {
      const atsCalls = await Promise.allSettled(
        newJobs.map((job) =>
          fetch(`${baseUrl}/api/ats`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId: job.id,
              jobDescription: job.jobDescription,
            }),
            cache: "no-store",
          })
        )
      );

      atsCalls.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value.ok) {
          atsTriggered += 1;
          return;
        }

        const jobId = newJobs[index]?.id || "unknown_job";
        const reason = result.status === "rejected" ? result.reason : `HTTP ${result.value.status}`;
        atsErrors.push(`${jobId}: ${String(reason)}`);
      });
    }

    const log = appendCronLog({
      runAt,
      status: atsErrors.length > 0 ? "error" : "success",
      scraped: Number(scrapeRes.scraped || 0),
      newJobs: newJobs.length,
      atsTriggered,
      message: `Scraped ${Number(scrapeRes.scraped || 0)} jobs, added ${newJobs.length} new jobs`,
      errors: atsErrors,
    });

    saveConfig({
      lastCronRunAt: runAt,
      lastCronResult: log.status,
    });

    return NextResponse.json({ success: true, data: log });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron run failed";
    const log = appendCronLog({
      runAt,
      status: "error",
      scraped: 0,
      newJobs: 0,
      atsTriggered: 0,
      message,
      errors: [message],
    });

    saveConfig({ lastCronRunAt: runAt, lastCronResult: "error" });
    return NextResponse.json({ success: false, error: message, data: log }, { status: 500 });
  }
}
