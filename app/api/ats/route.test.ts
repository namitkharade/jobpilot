import { beforeEach, describe, expect, it, vi } from "vitest";

const getAllJobsMock = vi.fn();
const updateJobMock = vi.fn();
const getConfigMock = vi.fn();
const getResumeDocumentMock = vi.fn();
const compileTexMock = vi.fn();
const extractPdfTextMock = vi.fn();
const completionCreateMock = vi.fn();

vi.mock("@/lib/job-store", () => ({
  getAllJobs: getAllJobsMock,
  updateJob: updateJobMock,
}));

vi.mock("@/lib/local-store", () => ({
  getConfig: getConfigMock,
}));

vi.mock("@/lib/openai", () => ({
  getResumeDocument: getResumeDocumentMock,
}));

vi.mock("@/lib/latex", () => ({
  compileTex: compileTexMock,
}));

vi.mock("@/lib/pdf", () => ({
  extractPdfText: extractPdfTextMock,
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: completionCreateMock,
      },
    };
  },
}));

describe("ATS route", () => {
  beforeEach(() => {
    vi.resetModules();
    getAllJobsMock.mockReset();
    updateJobMock.mockReset();
    getConfigMock.mockReset();
    getResumeDocumentMock.mockReset();
    compileTexMock.mockReset();
    extractPdfTextMock.mockReset();
    completionCreateMock.mockReset();

    getConfigMock.mockReturnValue({
      apiKeys: {
        openai: "test-openai-key",
      },
    });

    getAllJobsMock.mockResolvedValue([
      {
        id: "job_1",
        title: "Platform Engineer",
        company: "Acme",
        jobDescription: "Build TypeScript services with strong observability.",
        atsScore: null,
        atsKeywordGaps: [],
        atsSuggestions: [],
      },
    ]);
  });

  it("uses the job-specific draft before the base resume when scoring ATS", async () => {
    getResumeDocumentMock.mockImplementation((jobId?: string) => {
      if (jobId === "job_1") {
        return { texSource: "TAILORED_TEX", fileName: "tailored.tex", updatedAt: "2026-04-01T00:00:00.000Z" };
      }
      return { texSource: "BASE_TEX", fileName: "base.tex", updatedAt: "2026-04-01T00:00:00.000Z" };
    });
    compileTexMock.mockResolvedValue(Buffer.from("%PDF-tailored"));
    extractPdfTextMock.mockResolvedValue("Tailored PDF text");
    completionCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 91,
              matchedKeywords: ["TypeScript"],
              missingKeywords: ["observability"],
              suggestions: [],
              scoreBreakdown: {
                keywordMatch: 90,
                skillsAlignment: 92,
                experienceRelevance: 88,
                formatQuality: 95,
              },
              topMissingSkills: ["observability"],
              summary: "Compiled PDF analysis complete.",
            }),
          },
        },
      ],
    });

    const route = await import("./route");
    const response = await route.POST(
      new Request("http://localhost/api/ats", {
        method: "POST",
        body: JSON.stringify({ jobId: "job_1", jobDescription: "TypeScript role" }),
      }) as never
    );
    const body = (await response.json()) as { success: boolean; data: { score: number } };

    expect(body.success).toBe(true);
    expect(body.data.score).toBe(91);
    expect(compileTexMock).toHaveBeenCalledWith("TAILORED_TEX");
    expect(extractPdfTextMock).toHaveBeenCalled();
    expect(updateJobMock).toHaveBeenCalledWith(
      "job_1",
      expect.objectContaining({
        atsScore: 91,
      })
    );
  });

  it("returns a blocking error when the saved TeX cannot compile into a PDF", async () => {
    getResumeDocumentMock.mockImplementation((jobId?: string) =>
      jobId
        ? { texSource: "BROKEN_TEX", fileName: "broken.tex", updatedAt: "2026-04-01T00:00:00.000Z" }
        : null
    );
    compileTexMock.mockRejectedValue(new Error("LaTeX compilation failed"));

    const route = await import("./route");
    const response = await route.POST(
      new Request("http://localhost/api/ats", {
        method: "POST",
        body: JSON.stringify({ jobId: "job_1", jobDescription: "TypeScript role" }),
      }) as never
    );
    const body = (await response.json()) as { success: boolean; error: string };

    expect(response.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.error).toContain("ATS requires a valid compiled resume PDF");
    expect(completionCreateMock).not.toHaveBeenCalled();
  });

  it("falls back to the base resume only when no job-specific draft exists", async () => {
    getResumeDocumentMock.mockImplementation((jobId?: string) => {
      if (jobId === "job_1") {
        return null;
      }
      return { texSource: "BASE_TEX", fileName: "base.tex", updatedAt: "2026-04-01T00:00:00.000Z" };
    });
    compileTexMock.mockResolvedValue(Buffer.from("%PDF-base"));
    extractPdfTextMock.mockResolvedValue("Base PDF text");
    completionCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 72,
              matchedKeywords: [],
              missingKeywords: ["observability"],
              suggestions: [],
              scoreBreakdown: {
                keywordMatch: 70,
                skillsAlignment: 74,
                experienceRelevance: 73,
                formatQuality: 71,
              },
              topMissingSkills: ["observability"],
              summary: "Base compiled PDF analysis complete.",
            }),
          },
        },
      ],
    });

    const route = await import("./route");
    const response = await route.POST(
      new Request("http://localhost/api/ats", {
        method: "POST",
        body: JSON.stringify({ jobId: "job_1", jobDescription: "TypeScript role" }),
      }) as never
    );
    const body = (await response.json()) as { success: boolean; data: { score: number } };

    expect(body.success).toBe(true);
    expect(body.data.score).toBe(72);
    expect(compileTexMock).toHaveBeenCalledWith("BASE_TEX");
  });
});
