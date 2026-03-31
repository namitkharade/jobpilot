"use client";

import { useToast } from "@/components/ToastProvider";
import { useEffect, useMemo, useState } from "react";

type ResumeTab = "upload" | "preview";

interface ResumeStatusResponse {
  success: boolean;
  data?: {
    loaded: boolean;
    characterCount: number;
    text: string;
    updatedAt: string | null;
  };
  error?: string;
}

interface SaveResumeResponse {
  success: boolean;
  data?: {
    characterCount: number;
    updatedAt: string;
  };
  error?: string;
}

interface CoverLetterStatusResponse {
  success: boolean;
  data?: {
    loaded: boolean;
    characterCount: number;
    text: string;
    updatedAt: string | null;
  };
  error?: string;
}

interface CompileResumeResponse {
  success: boolean;
  pdfBase64?: string;
  error?: string;
}

const buildPdfBlob = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: "application/pdf" });
};

export default function ResumeEditor() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<ResumeTab>("upload");
  const [resumeText, setResumeText] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const [coverLetterText, setCoverLetterText] = useState("");
  const [coverLetterLastSavedAt, setCoverLetterLastSavedAt] = useState<string | null>(null);
  const [coverLetterSaving, setCoverLetterSaving] = useState(false);
  const [coverLetterPdfBase64, setCoverLetterPdfBase64] = useState<string | null>(null);
  const [coverLetterPdfLoading, setCoverLetterPdfLoading] = useState(false);
  const [coverLetterPdfError, setCoverLetterPdfError] = useState<string | null>(null);
  const [coverLetterPdfUrl, setCoverLetterPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadResumeStatus = async () => {
      setLoadingStatus(true);
      setStatusError(null);

      try {
        const res = await fetch("/api/resume/status", { cache: "no-store" });
        const body = (await res.json()) as ResumeStatusResponse;

        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error || "Failed to load resume");
        }

        setResumeText(body.data.text || "");
        setLastSavedAt(body.data.updatedAt || null);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to load resume";
        setStatusError(message);
      } finally {
        setLoadingStatus(false);
      }
    };

    loadResumeStatus();

    fetch("/api/cover-letter", { cache: "no-store" })
      .then((res) => res.json() as Promise<CoverLetterStatusResponse>)
      .then((body) => {
        if (body.success && body.data) {
          setCoverLetterText(body.data.text || "");
          setCoverLetterLastSavedAt(body.data.updatedAt || null);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!resumeText.trim()) {
      toast("Resume text cannot be empty", "info");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText }),
      });

      const body = (await res.json()) as SaveResumeResponse;
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error || "Failed to save resume");
      }

      setLastSavedAt(body.data.updatedAt);
      setPdfBase64(null);
      setPdfError(null);
      toast("Resume saved", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save resume";
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const compilePdf = async () => {
    setPdfLoading(true);
    setPdfError(null);

    try {
      const res = await fetch("/api/resume/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as CompileResumeResponse;

      if (!res.ok || !data.success || !data.pdfBase64) {
        throw new Error(data.error || "Compilation failed");
      }

      setPdfBase64(data.pdfBase64);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Compilation failed";
      setPdfError(message);
      setPdfBase64(null);
    } finally {
      setPdfLoading(false);
    }
  };

  const downloadPdf = (base64: string) => {
    const blob = buildPdfBlob(base64);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "resume.pdf";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveCoverLetter = async () => {
    if (!coverLetterText.trim()) {
      toast("Cover letter text cannot be empty", "info");
      return;
    }

    setCoverLetterSaving(true);
    try {
      const res = await fetch("/api/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverLetterText }),
      });

      const body = (await res.json()) as SaveResumeResponse;
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error || "Failed to save cover letter");
      }

      setCoverLetterLastSavedAt(body.data.updatedAt);
      setCoverLetterPdfBase64(null);
      setCoverLetterPdfError(null);
      toast("Cover letter saved", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save cover letter";
      toast(message, "error");
    } finally {
      setCoverLetterSaving(false);
    }
  };

  const compileCoverLetterPdf = async () => {
    setCoverLetterPdfLoading(true);
    setCoverLetterPdfError(null);

    try {
      const res = await fetch("/api/cover-letter/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverLetterText }),
      });
      const data = (await res.json()) as CompileResumeResponse;

      if (!res.ok || !data.success || !data.pdfBase64) {
        throw new Error(data.error || "Compilation failed");
      }

      setCoverLetterPdfBase64(data.pdfBase64);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Compilation failed";
      setCoverLetterPdfError(message);
      setCoverLetterPdfBase64(null);
    } finally {
      setCoverLetterPdfLoading(false);
    }
  };

  const lastSavedLabel = useMemo(() => {
    if (!lastSavedAt) return "Not saved yet";
    return new Date(lastSavedAt).toLocaleString();
  }, [lastSavedAt]);

  const coverLetterLastSavedLabel = useMemo(() => {
    if (!coverLetterLastSavedAt) return "Not saved yet";
    return new Date(coverLetterLastSavedAt).toLocaleString();
  }, [coverLetterLastSavedAt]);

  const pdfBlob = useMemo(() => {
    if (!pdfBase64) return null;
    return buildPdfBlob(pdfBase64);
  }, [pdfBase64]);

  useEffect(() => {
    if (!pdfBlob) {
      setPdfUrl(null);
      return;
    }

    const url = URL.createObjectURL(pdfBlob);
    setPdfUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [pdfBlob]);

  const coverLetterPdfBlob = useMemo(() => {
    if (!coverLetterPdfBase64) return null;
    return buildPdfBlob(coverLetterPdfBase64);
  }, [coverLetterPdfBase64]);

  useEffect(() => {
    if (!coverLetterPdfBlob) {
      setCoverLetterPdfUrl(null);
      return;
    }

    const url = URL.createObjectURL(coverLetterPdfBlob);
    setCoverLetterPdfUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [coverLetterPdfBlob]);

  if (loadingStatus) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
        Loading resume cache...
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3">
          <h3 className="text-base font-semibold">Resume Hub</h3>
          <p className="text-xs text-zinc-500">Manage your base resume used for ATS analysis.</p>
        </div>

        <div className="inline-flex rounded-md border border-zinc-200 p-1 dark:border-zinc-700">
          {(["upload", "preview"] as ResumeTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded px-3 py-1.5 text-xs font-medium capitalize ${
                activeTab === tab
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {statusError && (
          <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
            {statusError}
          </div>
        )}

        {activeTab === "upload" && (
          <div className="space-y-3">
            <textarea
              value={resumeText}
              onChange={(event) => setResumeText(event.target.value)}
              placeholder="Paste your base LaTeX/plain-text resume here"
              className="min-h-[320px] w-full rounded-md border border-zinc-200 bg-white p-3 font-mono text-sm text-zinc-900 outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-zinc-500">
                <p>Character count: {resumeText.length.toLocaleString()}</p>
                <p>Last saved: {lastSavedLabel}</p>
              </div>

              <button
                onClick={handleSave}
                disabled={saving || !resumeText.trim()}
                className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {saving ? "Saving..." : "Save Resume"}
              </button>
            </div>

            <div className="space-y-2">
              <button
                onClick={compilePdf}
                disabled={pdfLoading}
                className="h-9 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
              >
                {pdfLoading ? "Compiling..." : "Preview PDF"}
              </button>

              {pdfError && <p className="text-xs text-rose-700 dark:text-rose-300">{pdfError}</p>}

              {pdfBase64 && pdfUrl && (
                <div className="space-y-2">
                  <button
                    onClick={() => downloadPdf(pdfBase64)}
                    className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    Download PDF
                  </button>
                  <iframe
                    title="Resume PDF preview"
                    src={pdfUrl}
                    className="w-full rounded-md border border-zinc-200 dark:border-zinc-800"
                    height="600px"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "preview" && (
          <div className="space-y-2">
            <p className="text-xs text-zinc-500">Saved Resume Preview</p>
            <pre className="max-h-[440px] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900">
              {resumeText || "No saved resume yet."}
            </pre>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3">
          <h3 className="text-base font-semibold">Cover Letter Hub</h3>
          <p className="text-xs text-zinc-500">Save your base cover letter for job-specific tailoring.</p>
        </div>

        <div className="space-y-3">
          <textarea
            value={coverLetterText}
            onChange={(event) => setCoverLetterText(event.target.value)}
            placeholder="Paste your base cover letter here"
            className="min-h-[220px] w-full rounded-md border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-zinc-500">
              <p>Character count: {coverLetterText.length.toLocaleString()}</p>
              <p>Last saved: {coverLetterLastSavedLabel}</p>
            </div>

            <button
              onClick={handleSaveCoverLetter}
              disabled={coverLetterSaving || !coverLetterText.trim()}
              className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {coverLetterSaving ? "Saving..." : "Save Cover Letter"}
            </button>
          </div>

          <div className="space-y-2">
            <button
              onClick={compileCoverLetterPdf}
              disabled={coverLetterPdfLoading}
              className="h-9 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
            >
              {coverLetterPdfLoading ? "Compiling..." : "Preview Cover Letter PDF"}
            </button>

            {coverLetterPdfError && <p className="text-xs text-rose-700 dark:text-rose-300">{coverLetterPdfError}</p>}

            {coverLetterPdfBase64 && coverLetterPdfUrl && (
              <div className="space-y-2">
                <button
                  onClick={() => downloadPdf(coverLetterPdfBase64)}
                  className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Download Cover Letter PDF
                </button>
                <iframe
                  title="Cover letter PDF preview"
                  src={coverLetterPdfUrl}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800"
                  height="600px"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
