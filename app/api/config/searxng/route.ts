import { getSearchProviderHealth } from "@/lib/searxng";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const providers = await getSearchProviderHealth();
  const instances = providers
    .filter((provider) => provider.kind === "searxng")
    .map((provider) => ({
      url: provider.url,
      alive: provider.status === "ok",
      status: provider.status,
      message: provider.message,
    }));

  return NextResponse.json({
    success: true,
    data: {
      instances,
      providers,
      anyAlive: providers.some((provider) => provider.status === "ok"),
      activeInstance: instances.find((instance) => instance.alive)?.url || null,
    },
  });
}
