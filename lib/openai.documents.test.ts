import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("document cache helpers", () => {
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-docs-"));
    process.chdir(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("reads legacy cached content through the new structured helpers", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".resume-cache.json"),
      JSON.stringify(
        {
          resumeText: "\\documentclass{article}\n\\begin{document}\nHello Resume\n\\end{document}",
          updatedAt: "2026-04-01T00:00:00.000Z",
          coverLetterText: "Dear Hiring Team,\n\nThanks for reviewing my application.",
          coverLetterUpdatedAt: "2026-04-02T00:00:00.000Z",
          tailoredResumes: {
            job_1: {
              text: "\\documentclass{article}\n\\begin{document}\nTailored Resume\n\\end{document}",
              updatedAt: "2026-04-03T00:00:00.000Z",
            },
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const openai = await import("./openai");

    expect(openai.getResumeDocumentStatus()).toMatchObject({
      loaded: true,
      fileName: "resume.tex",
    });
    expect(openai.getResumeDocument("job_1")?.texSource).toContain("Tailored Resume");
    expect(openai.getCoverLetterDocumentStatus()).toMatchObject({
      loaded: true,
      fileName: "cover-letter.txt",
    });
    expect(openai.getCoverLetterTextForPrompt()).toContain("Dear Hiring Team");
  });

  it("stores structured base and job-specific TeX documents", async () => {
    const openai = await import("./openai");

    openai.saveResumeCache("\\documentclass{article}\n\\begin{document}\nBase Resume\n\\end{document}", {
      fileName: "base-resume.tex",
    });
    openai.saveTailoredResume(
      "job_7",
      "\\documentclass{article}\n\\begin{document}\nTailored CV\n\\end{document}",
      { fileName: "tailored-cv.tex" }
    );
    openai.saveCoverLetterCache(
      "\\documentclass{article}\n\\begin{document}\nBase Cover Letter\n\\end{document}",
      { fileName: "base-cover-letter.tex" }
    );

    const raw = JSON.parse(fs.readFileSync(path.join(tempDir, ".resume-cache.json"), "utf8")) as Record<string, unknown>;

    expect(raw.baseResumeDocument).toMatchObject({ fileName: "base-resume.tex" });
    expect((raw.tailoredResumeDocuments as Record<string, unknown>).job_7).toMatchObject({
      fileName: "tailored-cv.tex",
    });
    expect(raw.baseCoverLetterDocument).toMatchObject({ fileName: "base-cover-letter.tex" });
  });

  it("extracts prompt text from TeX documents", async () => {
    const openai = await import("./openai");

    const plainText = openai.extractPlainTextFromDocument(
      "\\documentclass{article}\n\\begin{document}\n\\section{Skills}\nReact and TypeScript\n\\end{document}"
    );

    expect(plainText).toContain("Skills");
    expect(plainText).toContain("React and TypeScript");
  });
});
