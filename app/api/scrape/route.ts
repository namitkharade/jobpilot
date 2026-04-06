import { scrapeJobsDetailed } from "@/lib/apify";
import { appendJobs, getAllJobs } from "@/lib/job-store";
import { JobListing, JobSource, LinkedInTimeRange } from "@/types";
import { NextResponse } from "next/server";

const ALLOWED_SOURCES: JobSource[] = ["linkedin", "indeed"];
const TIME_RANGE_OPTIONS: LinkedInTimeRange[] = [
  "any",
  "past_1h",
  "past_24h",
  "past_48h",
  "past_week",
  "past_2weeks",
  "past_month",
];

export async function POST(req: Request) {
  try {
    const { query, location, source, sources, timeRange } = await req.json();
    if (!query?.trim() || typeof query !== "string" || query.length > 300) {
      return NextResponse.json({ success: false, error: "Invalid query parameter" }, { status: 400 });
    }
    if (!location?.trim() || typeof location !== "string" || location.length > 200) {
      return NextResponse.json({ success: false, error: "Invalid location parameter" }, { status: 400 });
    }

    let selectedSources: JobSource[] = ALLOWED_SOURCES;
    if (typeof source === "string" && source !== "all") {
      if (!ALLOWED_SOURCES.includes(source as JobSource)) {
        return NextResponse.json({ success: false, error: "Invalid source parameter" }, { status: 400 });
      }
      selectedSources = [source as JobSource];
    } else if (Array.isArray(sources)) {
      const sanitized = sources.filter((s): s is JobSource => ALLOWED_SOURCES.includes(s));
      if (!sanitized.length) {
        return NextResponse.json({ success: false, error: "Invalid sources parameter" }, { status: 400 });
      }
      selectedSources = Array.from(new Set(sanitized));
    }

    let normalizedTimeRange: LinkedInTimeRange = "any";
    if (typeof timeRange === "string") {
      if (!TIME_RANGE_OPTIONS.includes(timeRange as LinkedInTimeRange)) {
        return NextResponse.json({ success: false, error: "Invalid time range parameter" }, { status: 400 });
      }
      normalizedTimeRange = timeRange as LinkedInTimeRange;
    }

    console.log(`Starting job scrape for query: "${query}", location: "${location}", sources: ${selectedSources.join(", ")}...`);

    // 1. Scrape jobs from selected Apify actors in parallel
    const { jobs: scrapedJobs, issues } = await scrapeJobsDetailed(
      query,
      location,
      selectedSources,
      normalizedTimeRange
    );
    console.log(`Scraped ${scrapedJobs.length} total jobs.`);

    if (!scrapedJobs.length && issues.length) {
      const issueSummary = issues.map((i) => `${i.source} (${i.actorId}): ${i.error}`);
      return NextResponse.json(
        {
          success: false,
          scraped: 0,
          newJobs: 0,
          duplicates: 0,
          error: "All job sources failed. Check scraper actor configuration.",
          issues,
          details: issueSummary,
        },
        { status: 502 }
      );
    }

    // 2. Persist to configured job store (postgres/local fallback)
    let newJobObjects: JobListing[] = [];
    try {
      newJobObjects = await appendJobs(scrapedJobs);
      console.log(`Successfully persisted ${newJobObjects.length} new jobs.`);
    } catch (persistError) {
      console.error("Job persistence failed:", persistError);
      // If persistence fails, still return the scraped data in the response
      return NextResponse.json({
        success: false,
        scraped: scrapedJobs.length,
        newJobs: 0,
        duplicates: scrapedJobs.length, // assuming none appended
        message: "Scraped successfully, but failed to persist jobs.",
        data: scrapedJobs,
        error: String(persistError)
      });
    }

    const duplicates = scrapedJobs.length - newJobObjects.length;

    return NextResponse.json({
      success: true,
      scraped: scrapedJobs.length,
      newJobs: newJobObjects.length,
      newJobObjects,
      duplicates,
      issues,
    });
  } catch (error) {
    console.error("Scrape API Route Error:", error);
    return NextResponse.json({ error: "Failed to scrape jobs: " + String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const jobs = await getAllJobs();
    
    // Sort by postedAt descending
    jobs.sort((a, b) => {
      const dateA = new Date(a.postedAt).getTime();
      const dateB = new Date(b.postedAt).getTime();
      
      const timeA = isNaN(dateA) ? 0 : dateA;
      const timeB = isNaN(dateB) ? 0 : dateB;

      return timeB - timeA;
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("Get Jobs API Route Error:", error);
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }
}
