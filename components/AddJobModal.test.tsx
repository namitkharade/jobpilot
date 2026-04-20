import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AddJobModal from "@/components/AddJobModal";
import { ToastProvider } from "@/components/ToastProvider";

describe("AddJobModal", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn() as typeof fetch;
  });

  it("starts URL import on paste and fills the form with imported fields", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          title: "Platform Engineer",
          company: "Northstar",
          location: "Remote",
          salary: "$140k - $180k",
          jobType: "Full-time",
          source: "manual",
          applyUrl: "https://jobs.northstar.dev/platform-engineer",
          jobDescription: "Build distributed systems.",
          companyDescription: "Northstar builds developer tools.",
          postedAt: "2026-04-02T00:00:00.000Z",
          jobPosterName: "Avery Quinn",
          jobPosterTitle: "Senior Recruiter",
        },
        warnings: [],
        extractedVia: "structured-data",
      }),
    });

    render(
      <ToastProvider>
        <AddJobModal open onClose={vi.fn()} />
      </ToastProvider>
    );

    fireEvent.paste(screen.getByLabelText(/apply url/i), {
      clipboardData: {
        getData: () => "https://jobs.northstar.dev/platform-engineer",
      },
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/job title/i)).toHaveValue("Platform Engineer");
    });

    expect(screen.getByLabelText(/company/i)).toHaveValue("Northstar");
    expect(screen.getByLabelText(/location/i)).toHaveValue("Remote");
    expect(screen.getByLabelText(/job description/i)).toHaveValue("Build distributed systems.");
    expect(screen.getByText(/imported from structured-data/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/jobs/import",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("renders inline warnings and import errors without closing the modal", async () => {
    const onClose = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            title: "Backend Engineer",
            company: "",
            location: "",
            salary: "",
            jobType: "Full-time",
            source: "manual",
            applyUrl: "https://example.com/backend-role",
            jobDescription: "Backend platform role.",
            companyDescription: "",
            postedAt: "",
            jobPosterName: "",
            jobPosterTitle: "",
          },
          warnings: ["Some fields still need review: company, location."],
          extractedVia: "heuristic",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          error: "Failed to fetch the job page (403).",
        }),
      });

    render(
      <ToastProvider>
        <AddJobModal open onClose={onClose} />
      </ToastProvider>
    );

    fireEvent.paste(screen.getByLabelText(/apply url/i), {
      clipboardData: {
        getData: () => "https://example.com/backend-role",
      },
    });

    expect(await screen.findByText(/some fields still need review/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/apply url/i), {
      target: { value: "https://example.com/blocked-role" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /retry import/i }).at(-1)!);

    expect(await screen.findByText(/failed to fetch the job page/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("only saves after explicit submission and includes imported metadata", async () => {
    const onClose = vi.fn();
    const onJobAdded = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            title: "Product Engineer",
            company: "Orbit",
            location: "Berlin",
            salary: "",
            jobType: "Full-time",
            source: "manual",
            applyUrl: "https://orbit.dev/careers/product-engineer",
            jobDescription: "Build product features with React and TypeScript.",
            companyDescription: "Orbit builds collaboration tooling.",
            postedAt: "2026-04-05T00:00:00.000Z",
            jobPosterName: "Mina Chen",
            jobPosterTitle: "Recruiter",
          },
          warnings: [],
          extractedVia: "meta-tags",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
        }),
      });

    render(
      <ToastProvider>
        <AddJobModal open onClose={onClose} onJobAdded={onJobAdded} />
      </ToastProvider>
    );

    fireEvent.paste(screen.getByLabelText(/apply url/i), {
      clipboardData: {
        getData: () => "https://orbit.dev/careers/product-engineer",
      },
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/job title/i)).toHaveValue("Product Engineer");
    });

    fireEvent.click(screen.getAllByRole("button", { name: /^add job$/i }).at(-1)!);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const secondCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    const requestBody = JSON.parse(secondCall?.[1]?.body as string) as {
      source: string;
      companyDescription: string;
      postedAt: string;
      jobPosterName: string;
      jobPosterTitle: string;
    };

    expect(secondCall?.[0]).toBe("/api/jobs");
    expect(requestBody.source).toBe("manual");
    expect(requestBody.companyDescription).toBe("Orbit builds collaboration tooling.");
    expect(requestBody.postedAt).toBe("2026-04-05T00:00:00.000Z");
    expect(requestBody.jobPosterName).toBe("Mina Chen");
    expect(requestBody.jobPosterTitle).toBe("Recruiter");
    expect(onJobAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
