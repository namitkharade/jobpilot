import net from "net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost"];

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] >= 224) return true; // multicast/reserved
  return false;
}

function normalizeIpv6(ip: string): string {
  return ip.toLowerCase().split("%")[0] || "";
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = normalizeIpv6(ip);
  if (!normalized) return true;
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique-local
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true; // link-local fe80::/10
  }
  if (normalized.startsWith("::ffff:127.")) return true;
  if (normalized.startsWith("::ffff:10.")) return true;
  if (normalized.startsWith("::ffff:169.254.")) return true;
  if (normalized.startsWith("::ffff:192.168.")) return true;
  if (/^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized)) return true;
  return false;
}

function isPrivateIpLiteral(host: string): boolean {
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    return isPrivateIpv4(host);
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(host);
  }
  return false;
}

function isBlockedHostname(host: string): boolean {
  const normalized = host.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(normalized)) return true;
  return BLOCKED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export interface UrlSafetyOptions {
  allowPrivateHosts?: boolean;
}

export async function assertSafeExternalUrl(rawUrl: string, options: UrlSafetyOptions = {}): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("URL must be a valid http or https address");
  }

  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs containing credentials are not allowed");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    throw new Error("URL hostname is required");
  }

  const allowPrivateHosts = options.allowPrivateHosts === true;
  if (!allowPrivateHosts) {
    if (isBlockedHostname(host)) {
      throw new Error("URL hostname is not allowed");
    }

    if (isPrivateIpLiteral(host)) {
      throw new Error("Private or loopback network addresses are not allowed");
    }
  }

  return parsed;
}
