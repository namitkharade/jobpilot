import { getConfig, maskSecret, saveConfig } from "@/lib/local-store";
import { getResumeCacheStatus } from "@/lib/openai";
import { assertSafeExternalUrl } from "@/lib/url-safety";
import axios from "axios";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const SERVICE_TO_CONFIG_KEY = {
  apify: "apify",
  hunter: "hunter",
  openai: "openai",
  searxng: "searxng",
  cronsecret: "cronSecret",
  gmailclientid: "gmailClientId",
  gmailclientsecret: "gmailClientSecret",
} as const;

async function normalizeSearXNGUrl(rawUrl: string): Promise<string> {
  const allowPrivateHosts = process.env.NODE_ENV !== "production";
  const url = await assertSafeExternalUrl(rawUrl, { allowPrivateHosts });

  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");

  return url.toString().replace(/\/+$/, "");
}

export async function GET() {
  const config = getConfig();
  return NextResponse.json({
    success: true,
    data: {
      defaultQuery: config.defaultQuery,
      defaultLocation: config.defaultLocation,
      jobStoreMode: config.jobStoreMode,
      cronEnabled: config.cronEnabled,
      lastCronRunAt: config.lastCronRunAt,
      lastCronResult: config.lastCronResult,
      apiKeys: {
        apifyMasked: maskSecret(config.apiKeys.apify),
        hunterMasked: maskSecret(config.apiKeys.hunter),
        openaiMasked: maskSecret(config.apiKeys.openai),
        searxngMasked: maskSecret(config.apiKeys.searxng),
        cronSecretMasked: maskSecret(config.apiKeys.cronSecret),
        gmailClientIdMasked: maskSecret(config.apiKeys.gmailClientId),
        gmailClientSecretMasked: maskSecret(config.apiKeys.gmailClientSecret),
      },
      resumeLoaded: getResumeCacheStatus().loaded,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const next = saveConfig(body || {});

    return NextResponse.json({
      success: true,
      data: {
        defaultQuery: next.defaultQuery,
        defaultLocation: next.defaultLocation,
        jobStoreMode: next.jobStoreMode,
        cronEnabled: next.cronEnabled,
        lastCronRunAt: next.lastCronRunAt,
        lastCronResult: next.lastCronResult,
        apiKeys: {
          apifyMasked: maskSecret(next.apiKeys.apify),
          hunterMasked: maskSecret(next.apiKeys.hunter),
          openaiMasked: maskSecret(next.apiKeys.openai),
          searxngMasked: maskSecret(next.apiKeys.searxng),
          cronSecretMasked: maskSecret(next.apiKeys.cronSecret),
          gmailClientIdMasked: maskSecret(next.apiKeys.gmailClientId),
          gmailClientSecretMasked: maskSecret(next.apiKeys.gmailClientSecret),
        },
        resumeLoaded: getResumeCacheStatus().loaded,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save config";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const service = String(body?.service || "").toLowerCase();
    let key = String(body?.key || "").trim();

    if (!service) {
      return NextResponse.json({ success: false, error: "Missing service or key" }, { status: 400 });
    }

    const configKey = SERVICE_TO_CONFIG_KEY[service as keyof typeof SERVICE_TO_CONFIG_KEY];
    if (!configKey) {
      return NextResponse.json({ success: false, error: "Unsupported service" }, { status: 400 });
    }

    if (!key && service !== "searxng") {
      return NextResponse.json({ success: false, error: "Missing service or key" }, { status: 400 });
    }

    if (service === "searxng" && key) {
      key = await normalizeSearXNGUrl(key);
    }

    const current = getConfig();
    const updated = saveConfig({
      apiKeys: {
        ...current.apiKeys,
        [configKey]: key,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        service,
        masked: maskSecret(updated.apiKeys[configKey]),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save API key";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const service = String(body?.service || "").toLowerCase();
    const key = String(body?.key || "").trim();

    const VALID_TEST_SERVICES = ["apify", "hunter", "openai", "searxng"];
    if (!VALID_TEST_SERVICES.includes(service)) {
      return NextResponse.json({ success: false, error: `Connection test not implemented for ${service}` }, { status: 400 });
    }

    const current = getConfig();
    const configKey = SERVICE_TO_CONFIG_KEY[service as keyof typeof SERVICE_TO_CONFIG_KEY];
    const token = key || (configKey ? (current.apiKeys[configKey] as string) : "") || "";
    if (!token) {
      return NextResponse.json({ success: false, error: `No ${service} key provided or found` }, { status: 400 });
    }

    if (service === "apify") {
      const res = await axios.get("https://api.apify.com/v2/users/me", {
        params: { token },
      });
      return NextResponse.json({ success: true, data: { service, status: "ok", account: res.data?.data?.username || "connected" } });
    }

    if (service === "hunter") {
      const res = await axios.get("https://api.hunter.io/v2/account", {
        params: { api_key: token },
      });
      return NextResponse.json({
        success: true,
        data: {
          service, status: "ok", account: res.data?.data?.email || "connected"
        }
      });
    }


    if (service === "openai") {
      await axios.get("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return NextResponse.json({ success: true, data: { service, status: "ok", account: "OpenAI Connected" } });
    }

    if (service === "searxng") {
      const safeBaseUrl = await normalizeSearXNGUrl(token);
      const res = await axios.get(`${safeBaseUrl}/search`, {
        params: { q: "test", format: "json" },
        timeout: 5000,
      });
      if (!res.data?.results) throw new Error("JSON format not enabled on this instance");
      return NextResponse.json({
        success: true,
        data: { service, status: "ok", account: `${res.data.results.length} results returned` },
      });
    }


    return NextResponse.json({ success: false, error: "Invalid service for test" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection test failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
