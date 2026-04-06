import axios from "axios";
import { getConfig } from "./local-store";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function getConfiguredSearXNGUrl(): string {
  return (process.env.SEARXNG_URL || getConfig().apiKeys.searxng || "").trim().replace(/\/+$/, "");
}

export function hasConfiguredSearXNG(): boolean {
  return Boolean(getConfiguredSearXNGUrl());
}

function getInstances(): string[] {
  const configured = getConfiguredSearXNGUrl();
  return configured ? [configured] : [];
}

export async function searchWeb(
  query: string,
  maxResults = 5
): Promise<SearchResult[]> {
  const instances = getInstances();
  if (!instances.length) {
    return [];
  }

  for (const instance of instances) {
    try {
      const res = await axios.get(`${instance}/search`, {
        params: {
          q: query,
          format: "json",
          categories: "general",
          language: "en",
          safesearch: "0",
        },
        timeout: 8000,
        headers: {
          "Accept": "application/json",
          "User-Agent": "JobPilot/1.0",
        },
      });

      if (!res.data?.results || !Array.isArray(res.data.results)) continue;

      return res.data.results
        .slice(0, maxResults)
        .map((r: Record<string, string>) => ({
          title: r.title || "",
          url: r.url || "",
          snippet: r.content || r.snippet || "",
        }))
        .filter((r: SearchResult) => r.url);
    } catch (err) {
      console.warn(`SearXNG instance ${instance} failed:`, err);
      continue;
    }
  }

  console.warn("Configured SearXNG instance failed for query:", query);
  return [];
}

export async function searchMultiple(
  queries: string[],
  maxResultsEach = 5
): Promise<SearchResult[]> {
  const results = await Promise.allSettled(
    queries.map((q) => searchWeb(q, maxResultsEach))
  );

  const all: SearchResult[] = [];
  results.forEach((r) => {
    if (r.status === "fulfilled") all.push(...r.value);
  });

  const seen = new Set<string>();
  return all.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}
