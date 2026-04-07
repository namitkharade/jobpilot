import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TexDocumentWorkspace from "@/components/TexDocumentWorkspace";
import { ToastProvider } from "@/components/ToastProvider";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TexDocumentWorkspace", () => {
  const originalFetch = global.fetch;
  const createObjectUrlMock = vi.fn(() => "blob:preview");
  const revokeObjectUrlMock = vi.fn();

  beforeEach(() => {
    global.fetch = vi.fn() as typeof fetch;
    global.URL.createObjectURL = createObjectUrlMock;
    global.URL.revokeObjectURL = revokeObjectUrlMock;
    createObjectUrlMock.mockClear();
    revokeObjectUrlMock.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  it("loads uploaded TeX into the editor and does not render a separate preview button", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          loaded: false,
          characterCount: 0,
          texSource: "",
          fileName: null,
          updatedAt: null,
        },
      })
    );

    const { container } = render(
      <ToastProvider>
        <TexDocumentWorkspace
          title="Resume Hub"
          description="Manage resume"
          documentLabel="Resume"
          fetchUrl="/api/resume"
          saveUrl="/api/resume"
          compileUrl="/api/resume/compile"
          fileNameFallback="resume.tex"
        />
      </ToastProvider>
    );

    await screen.findByText(/save this resume to refresh the pdf preview/i);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["\\documentclass{article}\n\\begin{document}\nHello\\end{document}"], "resume.tex", {
      type: "text/plain",
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/paste or upload resume tex here/i)).toHaveValue(
        "\\documentclass{article}\n\\begin{document}\nHello\\end{document}"
      );
    });

    expect(screen.queryByRole("button", { name: /preview/i })).not.toBeInTheDocument();
  });

  it("saves the draft, refreshes the PDF preview, and enables download after compile succeeds", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            loaded: false,
            characterCount: 0,
            texSource: "",
            fileName: null,
            updatedAt: null,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            loaded: true,
            characterCount: 24,
            texSource: "\\documentclass{article}",
            fileName: "resume.tex",
            updatedAt: "2026-04-07T00:00:00.000Z",
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          pdfBase64: btoa("%PDF-resume"),
        })
      );

    render(
      <ToastProvider>
        <TexDocumentWorkspace
          title="Resume Hub"
          description="Manage resume"
          documentLabel="Resume"
          fetchUrl="/api/resume"
          saveUrl="/api/resume"
          compileUrl="/api/resume/compile"
          fileNameFallback="resume.tex"
        />
      </ToastProvider>
    );

    const editor = await screen.findByPlaceholderText(/paste or upload resume tex here/i);
    fireEvent.change(editor, { target: { value: "\\documentclass{article}" } });
    fireEvent.click(screen.getByRole("button", { name: /save resume/i }));

    await waitFor(() => {
      expect(screen.getByTitle(/resume pdf preview/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /download resume pdf/i })).toBeEnabled();
  });

  it("shows compile errors while keeping the saved draft content in the editor", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            loaded: false,
            characterCount: 0,
            texSource: "",
            fileName: null,
            updatedAt: null,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            loaded: true,
            characterCount: 18,
            texSource: "\\broken{tex}",
            fileName: "resume.tex",
            updatedAt: "2026-04-07T00:00:00.000Z",
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: false,
          error: "LaTeX compilation failed",
        }, 500)
      );

    render(
      <ToastProvider>
        <TexDocumentWorkspace
          title="Resume Hub"
          description="Manage resume"
          documentLabel="Resume"
          fetchUrl="/api/resume"
          saveUrl="/api/resume"
          compileUrl="/api/resume/compile"
          fileNameFallback="resume.tex"
        />
      </ToastProvider>
    );

    const editor = await screen.findByPlaceholderText(/paste or upload resume tex here/i);
    fireEvent.change(editor, { target: { value: "\\broken{tex}" } });
    fireEvent.click(screen.getByRole("button", { name: /save resume/i }));

    await waitFor(() => {
      expect(screen.getByText(/latex compilation failed/i)).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText(/paste or upload resume tex here/i)).toHaveValue("\\broken{tex}");
    expect(screen.getByRole("button", { name: /download resume pdf/i })).toBeDisabled();
  });
});
