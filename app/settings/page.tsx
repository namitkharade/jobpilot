"use client";

import { useToast } from "@/components/ToastProvider";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type TestState = "idle" | "loading" | "success" | "error";

interface ConfigPayload {
  defaultQuery: string;
  defaultLocation: string;
  jobStoreMode: "local" | "postgres";
  cronEnabled: boolean;
  lastCronRunAt: string | null;
  lastCronResult: "success" | "error" | "skipped" | null;
  apiKeys: {
    apifyMasked: string;
    hunterMasked: string;
    openaiMasked: string;
    searxngMasked: string;
    cronSecretMasked: string;
    gmailClientIdMasked: string;
    gmailClientSecretMasked: string;
  };
}

export default function SettingsPage() {
  const { toast } = useToast();

  const [defaultQuery, setDefaultQuery] = useState("");
  const [defaultLocation, setDefaultLocation] = useState("");
  const [jobStoreMode, setJobStoreMode] = useState<"local" | "postgres">("postgres");
  const [cronEnabled, setCronEnabled] = useState(true);
  const [lastCronRunAt, setLastCronRunAt] = useState<string | null>(null);
  const [lastCronResult, setLastCronResult] = useState<string | null>(null);

  // API Key State
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [masks, setMasks] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, TestState>>({});

  const [resumeLoaded, setResumeLoaded] = useState(false);
  const [resumeChars, setResumeChars] = useState(0);

  // SearXNG State
  const [searxng, setSearxng] = useState<{
    instances: { url: string; alive: boolean; status?: string; message?: string }[];
    providers: { id: string; label: string; kind: string; status: string; configured: boolean; url: string; message: string }[];
    loading: boolean;
  }>({ instances: [], providers: [], loading: false });

  const checkSearxng = useCallback(async () => {
    setSearxng(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch("/api/config/searxng");
      const data = await res.json();
      if (data.success) {
        setSearxng({ instances: data.data.instances, providers: data.data.providers || [], loading: false });
      }
    } catch {
      toast("Failed to check SearXNG instances", "error");
    } finally {
      setSearxng(prev => ({ ...prev, loading: false }));
    }
  }, [toast]);

  const loadData = useCallback(async () => {
    const [configRes, resumeRes] = await Promise.all([
      fetch("/api/config", { cache: "no-store" }),
      fetch("/api/resume/status", { cache: "no-store" }),
    ]);

    const configBody = await configRes.json();
    const resumeBody = await resumeRes.json();

    if (configBody.success) {
      const config = configBody.data as ConfigPayload;
      setDefaultQuery(config.defaultQuery || "");
      setDefaultLocation(config.defaultLocation || "");
      setJobStoreMode(config.jobStoreMode || "postgres");
      setCronEnabled(Boolean(config.cronEnabled));
      setLastCronRunAt(config.lastCronRunAt || null);
      setLastCronResult(config.lastCronResult || null);
      
      setMasks({
        apify: config.apiKeys.apifyMasked,
        hunter: config.apiKeys.hunterMasked,
        openai: config.apiKeys.openaiMasked,
        searxng: config.apiKeys.searxngMasked,
        cronsecret: config.apiKeys.cronSecretMasked,
        gmailclientid: config.apiKeys.gmailClientIdMasked,
        gmailclientsecret: config.apiKeys.gmailClientSecretMasked,
      });
    }

    if (resumeBody.success) {
      setResumeLoaded(Boolean(resumeBody.data.loaded));
      setResumeChars(Number(resumeBody.data.characterCount || 0));
    }

    // Also check SearXNG
    checkSearxng();
  }, [checkSearxng]);

  useEffect(() => {
    loadData().catch(() => {
      toast("Failed to load settings", "error");
    });
  }, [loadData, toast]);

  const saveDefaults = async () => {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultQuery: defaultQuery.trim(),
        defaultLocation: defaultLocation.trim(),
        jobStoreMode,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      toast(data.error || "Failed to save defaults", "error");
      return;
    }
    toast("Default search saved", "success");
  };

  const saveKey = async (service: string) => {
    const key = keys[service] || "";
    if (!key && service !== "searxng") {
      toast("Please enter a key before saving", "info");
      return;
    }

    const res = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service, key }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      toast(data.error || `Failed to save ${service} key`, "error");
      return;
    }

    setMasks(prev => ({ ...prev, [service]: data.data.masked }));
    setKeys(prev => ({ ...prev, [service]: "" }));
    toast(`${service} key saved`, "success");
  };

  const testConnection = async (service: string) => {
    const key = keys[service] || "";
    setStatuses(prev => ({ ...prev, [service]: "loading" }));

    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, key }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setStatuses(prev => ({ ...prev, [service]: "error" }));
        toast(data.error || `${service} connection failed`, "error");
        return;
      }

      setStatuses(prev => ({ ...prev, [service]: "success" }));
      toast(`${service} connected: ${data.data.account || "OK"}`, "success");
    } catch {
      setStatuses(prev => ({ ...prev, [service]: "error" }));
      toast(`${service} test failed`, "error");
    }
  };

  const toggleCron = async (checked: boolean) => {
    setCronEnabled(checked);
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cronEnabled: checked }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setCronEnabled(!checked);
      toast(data.error || "Failed to update cron setting", "error");
      return;
    }
    toast(`Daily auto-scrape ${checked ? "enabled" : "disabled"}`, "success");
  };

  const clearResume = async () => {
    const res = await fetch("/api/resume/status", { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.success) {
      toast(data.error || "Failed to clear resume", "error");
      return;
    }

    setResumeLoaded(false);
    setResumeChars(0);
    toast("Resume cleared", "success");
  };

  const statusPill = (status: TestState) => {
    if (status === "loading") return <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800 animate-pulse transition-all">Testing...</span>;
    if (status === "success") return <span className="rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">Connected</span>;
    if (status === "error") return <span className="rounded bg-rose-100 px-2 py-1 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-400">Failed</span>;
    return <span className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">Not tested</span>;
  };

  const renderKeyField = (id: string, label: string, placeholder: string, isMultiline = false, canTest = true) => (
    <div key={id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">{label}</p>
        {canTest && statusPill(statuses[id] || "idle")}
      </div>
      {isMultiline ? (
        <textarea
          rows={3}
          value={keys[id] || ""}
          onChange={(e) => setKeys(prev => ({ ...prev, [id]: e.target.value }))}
          placeholder={masks[id] || placeholder}
          className="w-full rounded-md border border-zinc-200 bg-white p-3 text-xs font-mono dark:border-zinc-700 dark:bg-zinc-900"
        />
      ) : (
        <input
          type="password"
          value={keys[id] || ""}
          onChange={(e) => setKeys(prev => ({ ...prev, [id]: e.target.value }))}
          placeholder={masks[id] || placeholder}
          className="h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      )}
      <div className="mt-2 flex gap-2">
        {canTest && (
          <button onClick={() => testConnection(id)} className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
            Test Connection
          </button>
        )}
        <button onClick={() => saveKey(id)} className="rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          Save
        </button>
      </div>
    </div>
  );

  return (
    <main className="space-y-6 p-5 md:p-8 pb-20">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-zinc-500">Configure defaults, API keys, resume state, and scheduled automation.</p>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Default Search</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input
            value={defaultQuery}
            onChange={(e) => setDefaultQuery(e.target.value)}
            placeholder="Default role, e.g. Product Engineer"
            className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <input
            value={defaultLocation}
            onChange={(e) => setDefaultLocation(e.target.value)}
            placeholder="Default location, e.g. Remote"
            className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex h-10 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {jobStoreMode === "postgres"
              ? "Storage: PostgreSQL (persistent)"
              : "Storage: Local file fallback (set DATABASE_URL to switch)"}
          </div>
        </div>
        <button
          onClick={saveDefaults}
          className="mt-3 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Save Default Search
        </button>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">AI & Search Engines</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {renderKeyField("openai", "OpenAI", "Enter OpenAI API key")}
          {renderKeyField("apify", "Apify", "Enter Apify API token")}
          {renderKeyField("hunter", "Hunter.io", "Enter Hunter API key")}
          {renderKeyField("searxng", "SearXNG URL (optional override)", "https://your-instance.example (optional)")}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Gmail Integration</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {renderKeyField("gmailclientid", "Gmail Client ID", "Enter Gmail Client ID", false, false)}
            {renderKeyField("gmailclientsecret", "Gmail Client Secret", "Enter Gmail Client Secret", false, false)}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Search</h2>
            <p className="text-xs text-zinc-500">OpenAI web search is the default recruiter-discovery backend. SearXNG is an optional override.</p>
          </div>
          <button
            onClick={checkSearxng}
            disabled={searxng.loading}
            className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {searxng.loading ? (
              <svg className="h-3 w-3 animate-spin text-zinc-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : null}
            Test Providers
          </button>
        </div>

        <div className="space-y-2">
          {searxng.providers.map((provider) => (
            <div key={provider.id} className="flex items-center justify-between rounded-md border border-zinc-100 p-2.5 dark:border-zinc-800/50 dark:bg-zinc-900/30">
              <div>
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{provider.label}</div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {provider.message || (provider.configured ? "Configured" : "Not configured")}
                </div>
              </div>
              <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium ${
                provider.status === "ok"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : provider.status === "invalid_response"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}>
                {provider.status}
              </span>
            </div>
          ))}
          {searxng.instances.map((instance, idx) => (
            <div key={idx} className="flex items-center justify-between rounded-md border border-zinc-100 p-2.5 dark:border-zinc-800/50 dark:bg-zinc-900/30">
              <div>
                <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400">
                  {instance.url.length > 40 ? `${instance.url.substring(0, 37)}...` : instance.url}
                </span>
                {instance.message ? (
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{instance.message}</div>
                ) : null}
              </div>
              <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium ${
                instance.alive
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
                  : instance.status === "invalid_response"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                    : "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400"
              }`}>
                {instance.alive ? "Live" : instance.status === "invalid_response" ? "Invalid JSON" : "Down"}
              </span>
            </div>
          ))}
          {searxng.instances.length === 0 && searxng.providers.length === 0 && !searxng.loading && (
            <p className="py-2 text-center text-xs text-zinc-400">No search providers configured.</p>
          )}
        </div>
        <p className="mt-4 text-[10px] text-zinc-400 italic">
          No configuration needed — JobPilot automatically uses the first available live instance.
        </p>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">System & Automation</h2>
        <div className="space-y-4">
          {renderKeyField("cronsecret", "Cron Secret", "Enter CRON_SECRET for endpoint protection", false, false)}
          
          <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50">
            <h3 className="text-sm font-medium mb-3">Scheduling</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-white">Daily auto-scrape at 08:00 UTC</p>
                <div className="mt-1 flex flex-col gap-1">
                  <p className="text-xs text-zinc-500">Last run: {lastCronRunAt ? new Date(lastCronRunAt).toLocaleString() : "Never"}</p>
                  <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                    Last result: 
                    <span className={lastCronResult === "success" ? "text-emerald-600" : lastCronResult === "error" ? "text-rose-600" : "text-zinc-500"}>
                      {lastCronResult || "N/A"}
                    </span>
                  </p>
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input 
                  type="checkbox" 
                  checked={cronEnabled} 
                  onChange={(e) => toggleCron(e.target.checked)} 
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-zinc-200 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-blue-600"></div>
                <span className="ml-3 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                  {cronEnabled ? "Enabled" : "Disabled"}
                </span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Document Templates</h2>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {resumeLoaded ? (
              <>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 mr-2">Loaded</span>
                Base resume template cached with {resumeChars.toLocaleString()} characters.
              </>
            ) : "No base resume template loaded yet."}
          </p>
          <div className="flex gap-2">
            <button onClick={clearResume} className="rounded-md border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
              Clear Base Resume
            </button>
            <Link href="/resume" className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition-opacity">
              Open Document Hub
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
