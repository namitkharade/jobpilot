import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const compileTexMock = vi.fn(async (source: string) => Buffer.from(`compiled:${source}`));

vi.mock("@/lib/latex", () => ({
  compileTex: compileTexMock,
}));

describe("document routes", () => {
  const originalCwd = process.cwd();
  let tempDir = "";

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-routes-"));
    process.chdir(tempDir);
    vi.resetModules();
    compileTexMock.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("round-trips base and job-specific resume TeX through the API", async () => {
    const resumeRoute = await import("./resume/route");

    const saveBaseResponse = await resumeRoute.POST(
      new Request("http://localhost/api/resume", {
        method: "POST",
        body: JSON.stringify({
          texSource: "\\documentclass{article}\n\\begin{document}\nBase Resume\n\\end{document}",
          fileName: "resume-base.tex",
        }),
      }) as never
    );
    const saveBaseBody = (await saveBaseResponse.json()) as { success: boolean };
    expect(saveBaseBody.success).toBe(true);

    const saveJobResponse = await resumeRoute.POST(
      new Request("http://localhost/api/resume", {
        method: "POST",
        body: JSON.stringify({
          jobId: "job_22",
          texSource: "\\documentclass{article}\n\\begin{document}\nJob CV\n\\end{document}",
          fileName: "job-cv.tex",
        }),
      }) as never
    );
    const saveJobBody = (await saveJobResponse.json()) as { success: boolean };
    expect(saveJobBody.success).toBe(true);

    const getBaseResponse = await resumeRoute.GET(new Request("http://localhost/api/resume") as never);
    const getBaseBody = (await getBaseResponse.json()) as { data: { texSource: string; fileName: string | null } };
    expect(getBaseBody.data.texSource).toContain("Base Resume");
    expect(getBaseBody.data.fileName).toBe("resume-base.tex");

    const getJobResponse = await resumeRoute.GET(
      new Request("http://localhost/api/resume?jobId=job_22") as never
    );
    const getJobBody = (await getJobResponse.json()) as { data: { texSource: string; fileName: string | null } };
    expect(getJobBody.data.texSource).toContain("Job CV");
    expect(getJobBody.data.fileName).toBe("job-cv.tex");
  });

  it("wraps legacy cover letter text into LaTeX for editing and compile fallback", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".resume-cache.json"),
      JSON.stringify(
        {
          resumeText: "",
          updatedAt: "",
          tailoredResumes: {},
          coverLetterText: "Dear Hiring Team,\n\nThanks for your time.",
          coverLetterUpdatedAt: "2026-04-02T00:00:00.000Z",
          tailoredCoverLetters: {},
        },
        null,
        2
      ),
      "utf8"
    );

    const coverLetterRoute = await import("./cover-letter/route");
    const coverLetterCompileRoute = await import("./cover-letter/compile/route");

    const getResponse = await coverLetterRoute.GET(new Request("http://localhost/api/cover-letter") as never);
    const getBody = (await getResponse.json()) as { data: { texSource: string; fileName: string | null } };
    expect(getBody.data.texSource).toContain("\\documentclass");
    expect(getBody.data.fileName).toBe("cover-letter.tex");

    const compileResponse = await coverLetterCompileRoute.POST(
      new Request("http://localhost/api/cover-letter/compile", {
        method: "POST",
        body: JSON.stringify({ coverLetterText: "Dear Hiring Team,\n\nThanks for your time." }),
      })
    );
    const compileBody = (await compileResponse.json()) as { success: boolean };
    expect(compileBody.success).toBe(true);
    expect(compileTexMock).toHaveBeenCalledTimes(1);
    expect(compileTexMock.mock.calls[0]?.[0]).toContain("\\documentclass");
  });
});
