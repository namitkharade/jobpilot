import { describe, expect, it } from "vitest";

import { assertSafeExternalUrl } from "./url-safety";

describe("assertSafeExternalUrl", () => {
  it("allows normal public https URLs", async () => {
    await expect(assertSafeExternalUrl("https://example.com/jobs/123")).resolves.toBeInstanceOf(URL);
  });

  it("rejects localhost targets", async () => {
    await expect(assertSafeExternalUrl("http://localhost:3000/test")).rejects.toThrow(
      /not allowed/i
    );
  });

  it("rejects private IP literals", async () => {
    await expect(assertSafeExternalUrl("http://127.0.0.1:8080/a")).rejects.toThrow(
      /private|loopback/i
    );
    await expect(assertSafeExternalUrl("http://192.168.1.10:8080/a")).rejects.toThrow(
      /private|loopback/i
    );
  });

  it("rejects metadata hostname", async () => {
    await expect(assertSafeExternalUrl("http://metadata.google.internal/computeMetadata/v1")).rejects.toThrow(
      /not allowed/i
    );
  });

  it("allows private hosts only when explicitly enabled", async () => {
    await expect(
      assertSafeExternalUrl("http://localhost:8080/search", { allowPrivateHosts: true })
    ).resolves.toBeInstanceOf(URL);
  });
});
