import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function unauthorizedResponse() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="JobPilot"',
    },
  });
}

function serviceUnavailableResponse() {
  return new NextResponse("API authentication is not configured", {
    status: 503,
  });
}

function shouldBypassBasicAuth(pathname: string): boolean {
  return pathname === "/api/cron";
}

function shouldFailClosedApi(pathname: string): boolean {
  if (!pathname.startsWith("/api")) return false;
  if (shouldBypassBasicAuth(pathname)) return false;
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.ALLOW_UNAUTHENTICATED_API === "1") return false;
  return true;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (shouldBypassBasicAuth(pathname)) {
    return NextResponse.next();
  }

  const username = process.env.BASIC_AUTH_USER || "";
  const password = process.env.BASIC_AUTH_PASSWORD || "";

  if (!username || !password) {
    if (shouldFailClosedApi(pathname)) {
      return serviceUnavailableResponse();
    }
    return NextResponse.next();
  }

  const authHeader = request.headers.get("authorization") || "";
  const [scheme, encoded] = authHeader.split(" ");
  if (scheme !== "Basic" || !encoded) {
    return unauthorizedResponse();
  }

  const decoded = atob(encoded);
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return unauthorizedResponse();
  }

  const providedUser = decoded.slice(0, separatorIndex);
  const providedPass = decoded.slice(separatorIndex + 1);

  if (providedUser !== username || providedPass !== password) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|robots.txt|sitemap.xml).*)"],
};
