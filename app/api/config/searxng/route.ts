import { getConfig } from "@/lib/local-store";
import axios from "axios";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getInstances() {
  const configured = process.env.SEARXNG_URL || getConfig().apiKeys.searxng || "";
  return [configured, "https://namitkharade-searxng.hf.space"].filter(Boolean);
}

async function testInstance(baseUrl: string): Promise<boolean> {
  try {
    const res = await axios.get(`${baseUrl}/search`, {
      params: { q: "test", format: "json" },
      timeout: 5000,
      headers: {
        Accept: "application/json",
        "User-Agent": "JobPilot/1.0",
      },
    });
    return Array.isArray(res.data?.results);
  } catch {
    return false;
  }
}

export async function GET() {
  const instances = getInstances();
  const results = await Promise.all(
    instances.map(async (url) => ({
      url,
      alive: await testInstance(url),
    }))
  );

  const anyAlive = results.some((r) => r.alive);

  return NextResponse.json({
    success: true,
    data: {
      instances: results,
      anyAlive,
      activeInstance: results.find((r) => r.alive)?.url || null,
    },
  });
}
