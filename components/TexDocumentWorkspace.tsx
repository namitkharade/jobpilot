"use client";

import { useToast } from "@/components/ToastProvider";
import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

interface DocumentStatus {
  loaded: boolean;
  characterCount: number;
  texSource: string;
  fileName: string | null;
  updatedAt: string | null;
}

interface DocumentResponse {
  success: boolean;
  data?: DocumentStatus;
  error?: string;
}

interface CompileResponse {
  success: boolean;
  pdfBase64?: string;
  error?: string;
}

interface WorkspaceActions {
  texSource: string;
  fileName: string;
  isDirty: boolean;
  loading: boolean;
  saving: boolean;
  pdfLoading: boolean;
  reload: () => Promise<void>;
  save: () => Promise<void>;
}

interface TexDocumentWorkspaceProps {
  title: string;
  description: string;
  documentLabel: string;
  fetchUrl: string;
  saveUrl: string;
  compileUrl: string;
  queryJobId?: string;
  saveLabel?: string;
  downloadLabel?: string;
  emptyPreviewMessage?: string;
  fileNameFallback: string;
  refreshToken?: number;
  actions?: (actions: WorkspaceActions) => ReactNode;
}

const buildPdfBlob = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "application/pdf" });
};

function buildUrl(baseUrl: string, jobId?: string) {
  if (!jobId) return baseUrl;
  const url = new URL(baseUrl, "http://localhost");
  url.searchParams.set("jobId", jobId);
  return `${url.pathname}${url.search}`;
}

export default function TexDocumentWorkspace({
  title,
  description,
  documentLabel,
  fetchUrl,
  saveUrl,
  compileUrl,
  queryJobId,
  saveLabel,
  downloadLabel,
  emptyPreviewMessage,
  fileNameFallback,
  refreshToken,
  actions,
}: TexDocumentWorkspaceProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [texSource, setTexSource] = useState("");
  const [savedSource, setSavedSource] = useState("");
  const [fileName, setFileName] = useState(fileNameFallback);
  const [savedFileName, setSavedFileName] = useState(fileNameFallback);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const downloadText = downloadLabel || `Download ${documentLabel} PDF`;
  const saveText = saveLabel || `Save ${documentLabel}`;
  const isDirty = texSource !== savedSource || (fileName.trim() || fileNameFallback) !== savedFileName;

  const compileSavedDocument = async () => {
    setPdfLoading(true);
    setPdfError(null);

    try {
      const response = await fetch(compileUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queryJobId ? { jobId: queryJobId } : {}),
      });
      const body = (await response.json()) as CompileResponse;

      if (!response.ok || !body.success || !body.pdfBase64) {
        throw new Error(body.error || "Failed to compile PDF preview");
      }

      setPdfBase64(body.pdfBase64);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to compile PDF preview";
      setPdfBase64(null);
      setPdfError(message);
    } finally {
      setPdfLoading(false);
    }
  };

  const loadDocument = async () => {
    setLoading(true);
    setStatusError(null);

    try {
      const response = await fetch(buildUrl(fetchUrl, queryJobId), { cache: "no-store" });
      const body = (await response.json()) as DocumentResponse;

      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error || `Failed to load ${documentLabel.toLowerCase()}`);
      }

      const nextSource = body.data.texSource || "";
      const nextFileName = body.data.fileName || fileNameFallback;
      setTexSource(nextSource);
      setSavedSource(nextSource);
      setFileName(nextFileName);
      setSavedFileName(nextFileName);
      setUpdatedAt(body.data.updatedAt);
      setPdfError(null);
      setPdfBase64(null);

      if (body.data.loaded && nextSource.trim()) {
        await compileSavedDocument();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `Failed to load ${documentLabel.toLowerCase()}`;
      setStatusError(message);
      setPdfBase64(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocument();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl, queryJobId, refreshToken]);

  const pdfBlob = useMemo(() => {
    if (!pdfBase64) return null;
    return buildPdfBlob(pdfBase64);
  }, [pdfBase64]);

  useEffect(() => {
    if (!pdfBlob) {
      setPdfUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(pdfBlob);
    setPdfUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [pdfBlob]);

  const handleSave = async () => {
    if (!texSource.trim()) {
      toast(`${documentLabel} TeX cannot be empty`, "info");
      return;
    }

    setSaving(true);
    setStatusError(null);

    try {
      const response = await fetch(saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texSource,
          fileName: fileName.trim() || fileNameFallback,
          jobId: queryJobId || undefined,
        }),
      });
      const body = (await response.json()) as DocumentResponse;

      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error || `Failed to save ${documentLabel.toLowerCase()}`);
      }

      setSavedSource(texSource);
      const nextFileName = body.data.fileName || fileNameFallback;
      setFileName(nextFileName);
      setSavedFileName(nextFileName);
      setUpdatedAt(body.data.updatedAt);
      toast(`${documentLabel} saved`, "success");
      await compileSavedDocument();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : `Failed to save ${documentLabel.toLowerCase()}`;
      setStatusError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imported = await file.text();
      setTexSource(imported);
      setFileName(file.name || fileNameFallback);
      toast(`${documentLabel} file loaded into the editor`, "success");
    } catch {
      toast(`Failed to read ${documentLabel.toLowerCase()} file`, "error");
    } finally {
      event.target.value = "";
    }
  };

  const handleDownload = () => {
    if (!pdfBase64) return;

    const blob = buildPdfBlob(pdfBase64);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = (fileName.trim() || fileNameFallback).replace(/\.tex$/i, ".pdf");
    link.click();
    URL.revokeObjectURL(url);
  };

  const actionProps: WorkspaceActions = {
    texSource,
    fileName,
    isDirty,
    loading,
    saving,
    pdfLoading,
    reload: loadDocument,
    save: handleSave,
  };

  const lastSavedLabel = updatedAt ? new Date(updatedAt).toLocaleString() : "Not saved yet";

  return (
    <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="text-xs text-zinc-500">{description}</p>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <p>{isDirty ? "Unsaved changes" : "Saved draft loaded"}</p>
            <p>Last saved: {lastSavedLabel}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Upload .tex
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !texSource.trim()}
            className="h-9 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving ? "Saving..." : saveText}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!pdfBase64}
            className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            {downloadText}
          </button>
          {actions?.(actionProps)}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".tex,text/plain"
          className="hidden"
          onChange={handleFileImport}
        />
      </div>

      <div className="grid grid-cols-1 gap-0 xl:grid-cols-2">
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800 xl:border-r xl:border-b-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">TeX Source</label>
            <div className="text-xs text-zinc-500">
              <span>Characters: {texSource.length.toLocaleString()}</span>
            </div>
          </div>

          <input
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            placeholder={fileNameFallback}
            className="mb-3 h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
          />

          <textarea
            value={texSource}
            onChange={(event) => setTexSource(event.target.value)}
            placeholder={`Paste or upload ${documentLabel.toLowerCase()} TeX here`}
            className="min-h-[520px] w-full rounded-md border border-zinc-200 bg-white p-3 font-mono text-sm text-zinc-900 outline-none ring-zinc-300 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />

          {statusError && (
            <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
              {statusError}
            </p>
          )}
        </div>

        <div className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">Saved PDF Preview</label>
            {pdfLoading && <span className="text-xs text-zinc-500">Refreshing preview...</span>}
          </div>

          {loading ? (
            <div className="grid min-h-[520px] place-items-center rounded-md border border-dashed border-zinc-200 bg-zinc-50 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
              Loading {documentLabel.toLowerCase()}...
            </div>
          ) : pdfUrl ? (
            <iframe
              title={`${documentLabel} PDF preview`}
              src={pdfUrl}
              className="min-h-[520px] w-full rounded-md border border-zinc-200 dark:border-zinc-800"
            />
          ) : (
            <div className="grid min-h-[520px] place-items-center rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="space-y-3">
                <p>{emptyPreviewMessage || `Save this ${documentLabel.toLowerCase()} to refresh the PDF preview.`}</p>
                {pdfError && (
                  <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-left text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
                    {pdfError}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
