import axios from "axios";

import { SearchProviderStatus } from "@/types";

import { getConfig } from "./local-store";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProviderHealth {
  id: string;
  label: string;
  kind: "openai-web" | "searxng";
  status: SearchProviderStatus;
  configured: boolean;
  url: string;
  message: string;
}

export interface SearchExecutionResult {
  results: SearchResult[];
  status: SearchProviderStatus;
  message: string;
  provider: string;
}

export function getConfiguredSearXNGUrl(): string {
  return (process.env.SEARXNG_URL || getConfig().apiKeys.searxng || "").trim().replace(/\/+$/, "");
}

export function getConfiguredSearXNGUrls(): string[] {
  const configured = getConfiguredSearXNGUrl();
  return configured ? [configured] : [];
}

export function hasConfiguredSearXNG(): boolean {
  return getConfiguredSearXNGUrls().length > 0;
}

export function hasConfiguredOpenAI(): boolean {
  return Boolean(getConfig().apiKeys.openai);
}

async function executeSearXNGQuery(baseUrl: string, query: string, maxResults = 5): Promise<SearchExecutionResult> {
  try {
    const res = await axios.get(`${baseUrl}/search`, {
      params: {
        q: query,
        format: "json",
        categories: "general",
        language: "en",
        safesearch: "0",
      },
      timeout: 8000,
      headers: {
        Accept: "application/json",
        "User-Agent": "JobPilot/1.0",
      },
      transformResponse: (payload) => payload,
      validateStatus: () => true,
    });

    if (res.status >= 400) {
      return {
        results: [],
        status: "invalid_response",
        message: `SearXNG returned HTTP ${res.status}`,
        provider: baseUrl,
      };
    }

    let parsed: { results?: Array<Record<string, string>> } | null = null;
    try {
      parsed = JSON.parse(typeof res.data === "string" ? res.data : JSON.stringify(res.data)) as {
        results?: Array<Record<string, string>>;
      };
    } catch {
      parsed = null;
    }

    if (!parsed || !Array.isArray(parsed.results)) {
      return {
        results: [],
        status: "invalid_response",
        message: "SearXNG did not return JSON search results",
        provider: baseUrl,
      };
    }

    const results = parsed.results
      .slice(0, maxResults)
      .map((entry) => ({
        title: entry.title || "",
        url: entry.url || "",
        snippet: entry.content || entry.snippet || "",
      }))
      .filter((entry) => entry.url);

    return {
      results,
      status: "ok",
      message: results.length ? "" : "SearXNG returned no results",
      provider: baseUrl,
    };
  } catch (error) {
    return {
      results: [],
      status: "unavailable",
      message: error instanceof Error ? error.message : "SearXNG unavailable",
      provider: baseUrl,
    };
  }
}

export async function getSearchProviderHealth(): Promise<SearchProviderHealth[]> {
  const providers: SearchProviderHealth[] = [
    {
      id: "openai-web",
      label: "OpenAI Web Search",
      kind: "openai-web",
      status: hasConfiguredOpenAI() ? "ok" : "unavailable",
      configured: hasConfiguredOpenAI(),
      url: "",
      message: hasConfiguredOpenAI() ? "Available via configured OpenAI API key" : "OpenAI API key not configured",
    },
  ];

  const searxngUrls = getConfiguredSearXNGUrls();
  if (!searxngUrls.length) {
    providers.push({
      id: "searxng",
      label: "SearXNG",
      kind: "searxng",
      status: "unavailable",
      configured: false,
      url: "",
      message: "No SearXNG URL configured",
    });
    return providers;
  }

  const checks = await Promise.all(searxngUrls.map((url) => executeSearXNGQuery(url, "test", 1)));
  checks.forEach((check, index) => {
    providers.push({
      id: `searxng-${index + 1}`,
      label: "SearXNG",
      kind: "searxng",
      status: check.status,
      configured: true,
      url: searxngUrls[index] || "",
      message: check.message || (check.status === "ok" ? "JSON search endpoint reachable" : ""),
    });
  });

  return providers;
}

export async function searchWebDetailed(query: string, maxResults = 5): Promise<SearchExecutionResult> {
  const instances = getConfiguredSearXNGUrls();
  if (!instances.length) {
    return {
      results: [],
      status: "unavailable",
      message: "No SearXNG URL configured",
      provider: "",
    };
  }

  for (const instance of instances) {
    const result = await executeSearXNGQuery(instance, query, maxResults);
    if (result.status === "ok" || result.status === "invalid_response") {
      return result;
    }
  }

  return {
    results: [],
    status: "unavailable",
    message: "All configured SearXNG instances failed",
    provider: instances[0] || "",
  };
}

export async function searchWeb(query: string, maxResults = 5): Promise<SearchResult[]> {
  const result = await searchWebDetailed(query, maxResults);
  return result.results;
}

export async function searchMultipleDetailed(
  queries: string[],
  maxResultsEach = 5
): Promise<{
  results: SearchResult[];
  status: SearchProviderStatus;
  message: string;
  provider: string;
}> {
  const executions = await Promise.all(queries.map((query) => searchWebDetailed(query, maxResultsEach)));
  const successful = executions.filter((entry) => entry.status === "ok");

  const allResults = successful.flatMap((entry) => entry.results);
  const deduped: SearchResult[] = [];
  const seen = new Set<string>();

  allResults.forEach((entry) => {
    if (seen.has(entry.url)) return;
    seen.add(entry.url);
    deduped.push(entry);
  });

  const invalid = executions.find((entry) => entry.status === "invalid_response");
  if (successful.length > 0) {
    return {
      results: deduped,
      status: "ok",
      message: "",
      provider: successful[0]?.provider || "",
    };
  }

  if (invalid) {
    return {
      results: [],
      status: "invalid_response",
      message: invalid.message,
      provider: invalid.provider,
    };
  }

  return {
    results: [],
    status: "unavailable",
    message: executions[0]?.message || "Search provider unavailable",
    provider: executions[0]?.provider || "",
  };
}

export async function searchMultiple(
  queries: string[],
  maxResultsEach = 5
): Promise<SearchResult[]> {
  const result = await searchMultipleDetailed(queries, maxResultsEach);
  return result.results;
}
