import { getConfig, getLast7DaysLogs } from "@/lib/local-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = getConfig();
  const secret = process.env.CRON_SECRET || config.apiKeys.cronSecret;

  if (process.env.NODE_ENV === "production" && !secret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET must be configured in production" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const logs = getLast7DaysLogs();
  return NextResponse.json({
    success: true,
    data: logs,
  });
}
