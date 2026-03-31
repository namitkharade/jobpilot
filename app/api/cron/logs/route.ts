import { getLast7DaysLogs } from "@/lib/local-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const logs = getLast7DaysLogs();
  return NextResponse.json({
    success: true,
    data: logs,
  });
}
