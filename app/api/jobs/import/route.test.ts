import { beforeEach, describe, expect, it, vi } from "vitest";

const runStructuredResponseMock = vi.fn();

vi.mock("@/lib/openai", () => ({
  runStructuredResponse: runStructuredResponseMock,
}));

describe("job import route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    global.fetch = vi.fn() as typeof fetch;
  });

  it("imports a job from JobPosting JSON-LD", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        `
          <html>
            <head>
              <title>Senior Product Engineer | Acme</title>
              <script type="application/ld+json">
                {
                  "@context": "https://schema.org",
                  "@type": "JobPosting",
                  "title": "Senior Product Engineer",
                  "description": "<p>Build product systems with TypeScript.</p>",
                  "datePosted": "2026-04-01",
                  "employmentType": "FULL_TIME",
                  "hiringOrganization": {
                    "@type": "Organization",
                    "name": "Acme",
                    "description": "Acme builds internal collaboration tools."
                  },
                  "jobLocation": {
                    "@type": "Place",
                    "address": {
                      "@type": "PostalAddress",
                      "addressLocality": "Berlin",
                      "addressCountry": "Germany"
                    }
                  },
                  "baseSalary": {
                    "@type": "MonetaryAmount",
                    "currency": "EUR",
                    "value": {
                      "@type": "QuantitativeValue",
                      "minValue": 95000,
                      "maxValue": 120000,
                      "unitText": "YEAR"
                    }
                  },
                  "url": "https://careers.acme.com/jobs/123"
                }
              </script>
            </head>
          </html>
        `,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }
      )
    );

    const route = await import("./route");
    const response = await route.POST(
      new Request("http://localhost/api/jobs/import", {
        method: "POST",
        body: JSON.stringify({ url: "https://careers.acme.com/jobs/123" }),
      }) as never
    );
    const body = (await response.json()) as {
      success: boolean;
      extractedVia: string;
      data: {
        title: string;
        company: string;
        location: string;
        salary: string;
        source: string;
        jobDescription: string;
      };
      warnings: string[];
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.extractedVia).toBe("structured-data");
    expect(body.data.title).toBe("Senior Product Engineer");
    expect(body.data.company).toBe("Acme");
    expect(body.data.location).toBe("Berlin, Germany");
    expect(body.data.salary).toContain("EUR95000 - EUR120000 YEAR");
    expect(body.data.source).toBe("manual");
    expect(body.data.jobDescription).toContain("Build product systems");
    expect(body.warnings).toEqual([]);
    expect(runStructuredResponseMock).not.toHaveBeenCalled();
  });

  it("falls back to meta tags when structured data is absent", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        `
          <html>
            <head>
              <title>Staff Frontend Engineer | Linear</title>
              <meta property="og:title" content="Staff Frontend Engineer | Linear" />
              <meta property="og:description" content="Own the collaboration surface for Linear's web app." />
              <meta property="og:site_name" content="Linear" />
              <meta name="location" content="Remote" />
              <link rel="canonical" href="https://linear.app/careers/staff-frontend-engineer" />
            </head>
            <body>Join our team.</body>
          </html>
        `,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }
      )
    );

    const route = await import("./route");
    const response = await route.POST(
      new Request("http://localhost/api/jobs/import", {
        method: "POST",
        body: JSON.stringify({ url: "https://linear.app/careers/staff-frontend-engineer" }),
      }) as never
    );
    const body = (await response.json()) as {
      success: boolean;
      extractedVia: string;
      data: {
        title: string;
        company: string;
        source: string;
        jobDescription: string;
      };
    };

    expect(body.success).toBe(true);
    expect(body.extractedVia).toBe("meta-tags");
    expect(body.data.title).toBe("Staff Frontend Engineer");
    expect(body.data.company).toBe("Linear");
    expect(body.data.source).toBe("manual");
    expect(body.data.jobDescription).toContain("collaboration surface");
    expect(runStructuredResponseMock).not.toHaveBeenCalled();
  });

  it("uses AI fallback when deterministic extraction is incomplete", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        `
          <html>
            <head>
              <title>Careers</title>
            </head>
            <body>
              <main>
                <h1>Join our platform team</h1>
                <p>Distributed systems, TypeScript, and observability.</p>
              </main>
            </body>
          </html>
        `,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }
      )
    );
    runStructuredResponseMock.mockResolvedValue({
      data: {
        title: "Platform Engineer",
        company: "Northstar",
        location: "Remote",
        salary: "",
        jobType: "Full-time",
        source: "manual",
        applyUrl: "https://jobs.northstar.dev/platform-engineer",
        jobDescription: "Build distributed TypeScript services with strong observability.",
        companyDescription: "",
        postedAt: "2026-04-02T00:00:00.000Z",
        jobPosterName: "",
        jobPosterTitle: "",
      },
    });

    const route = await import("./route");
    const response = await route.POST(
      new Request("http://localhost/api/jobs/import", {
        method: "POST",
        body: JSON.stringify({ url: "https://jobs.northstar.dev/platform-engineer" }),
      }) as never
    );
    const body = (await response.json()) as {
      success: boolean;
      extractedVia: string;
      warnings: string[];
      data: {
        title: string;
        company: string;
        location: string;
      };
    };

    expect(body.success).toBe(true);
    expect(body.extractedVia).toBe("openai-fallback");
    expect(body.data.title).toBe("Platform Engineer");
    expect(body.data.company).toBe("Northstar");
    expect(body.data.location).toBe("Remote");
    expect(body.warnings).toContain("Used AI fallback to complete missing job fields.");
    expect(runStructuredResponseMock).toHaveBeenCalledTimes(1);
  });

  it("returns partial data with warnings when AI fallback is unavailable", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        `
          <html>
            <head>
              <title>Careers</title>
            </head>
            <body>
              <main>
                <p>Remote role on a backend platform team.</p>
              </main>
            </body>
          </html>
        `,
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }
      )
    );
    runStructuredResponseMock.mockRejectedValue(new Error("OpenAI API key is missing in configuration."));

    const route = await import("./route");
    const response = await route.POST(
      new Request("http://localhost/api/jobs/import", {
        method: "POST",
        body: JSON.stringify({ url: "https://careers.example.com/backend-role" }),
      }) as never
    );
    const body = (await response.json()) as {
      success: boolean;
      warnings: string[];
      data: {
        applyUrl: string;
        source: string;
      };
      extractedVia: string;
    };

    expect(body.success).toBe(true);
    expect(body.extractedVia).toBe("meta-tags");
    expect(body.data.applyUrl).toBe("https://careers.example.com/backend-role");
    expect(body.data.source).toBe("manual");
    expect(body.warnings.some((warning) => warning.includes("AI fallback unavailable"))).toBe(true);
    expect(body.warnings.some((warning) => warning.includes("Some fields still need review"))).toBe(true);
  });

  it("rejects invalid URLs and non-html responses cleanly", async () => {
    const route = await import("./route");

    const invalidResponse = await route.POST(
      new Request("http://localhost/api/jobs/import", {
        method: "POST",
        body: JSON.stringify({ url: "notaurl" }),
      }) as never
    );
    const invalidBody = (await invalidResponse.json()) as { success: boolean; error: string };

    expect(invalidResponse.status).toBe(400);
    expect(invalidBody.success).toBe(false);
    expect(invalidBody.error).toContain("valid http or https job URL");

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("pdf bytes", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      })
    );

    const nonHtmlResponse = await route.POST(
      new Request("http://localhost/api/jobs/import", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/job.pdf" }),
      }) as never
    );
    const nonHtmlBody = (await nonHtmlResponse.json()) as { success: boolean; error: string };

    expect(nonHtmlResponse.status).toBe(422);
    expect(nonHtmlBody.success).toBe(false);
    expect(nonHtmlBody.error).toContain("did not return an HTML job page");
  });
});
