"use client";

import { useToast } from "@/components/ToastProvider";
import { JobListing, RecruiterProfile } from "@/types";
import { useEffect, useMemo, useState } from "react";

interface EmailDrafterProps {
  jobId: string;
  recruiter: RecruiterProfile;
  jobListing: JobListing;
  resumeSummary: string;
}

interface EmailVariant {
  subject: string;
  body: string;
  wordCount: number;
  hookType: string;
  callToAction: string;
  _tone?: string;
}

function detectVariantFromTitle(title: string): "recruiter" | "hiring-manager" | "department-head" {
  const normalized = title.toLowerCase();
  if (normalized.includes("head") || normalized.includes("vp") || normalized.includes("chief")) {
    return "department-head";
  }
  if (normalized.includes("manager") || normalized.includes("director")) {
    return "hiring-manager";
  }
  return "recruiter";
}

export default function EmailDrafter({
  jobId,
  recruiter,
  jobListing,
  resumeSummary,
}: EmailDrafterProps) {
  const { toast } = useToast();
  const TONES = ["professional", "conversational", "direct"] as const;
  const RECIPIENT_VARIANTS = ["recruiter", "hiring-manager", "department-head"] as const;
  type Tone = (typeof TONES)[number];
  type RecipientVariant = (typeof RECIPIENT_VARIANTS)[number];

  const [tone, setTone] = useState<Tone>("professional");
  const [variantType, setVariantType] = useState<RecipientVariant>(detectVariantFromTitle(recruiter.title || ""));
  const [variants, setVariants] = useState<EmailVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingTone, setEditingTone] = useState<Tone | null>(null);
  const [sentStatus, setSentStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setVariantType(detectVariantFromTitle(recruiter.title || ""));
  }, [recruiter.title]);

  const generateEmails = async (selectedTone: Tone) => {
    setLoading(true);
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          recruiter,
          jobListing,
          resumeSummary,
          tone: selectedTone,
          variant: variantType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setVariants(data.data);
        setEditingTone(null);
        toast("Email drafts ready", "success");
      } else {
        toast(data.error || "Failed to generate emails", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Failed to generate emails", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleToneChange = (newTone: Tone) => {
    setTone(newTone);
  };

  const activeVariant = useMemo(
    () => variants.find((item) => item._tone === tone) || variants[0] || null,
    [tone, variants]
  );

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast("Email copied", "success");
  };

  const handleSendStatus = async (toneKey: string) => {
    const isSent = !sentStatus[toneKey];
    setSentStatus((prev) => ({ ...prev, [toneKey]: isSent }));

    if (isSent) {
      try {
        await fetch("/api/jobs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: jobId, status: "applied" }),
        });
      } catch (err) {
        console.error("Failed to update status", err);
        toast("Failed to update application status", "error");
      }
    }
  };

  const updateBody = (toneKey: string, newBody: string) => {
    const newVariants = [...variants];
    const index = newVariants.findIndex((item) => item._tone === toneKey);
    if (index === -1) return;
    newVariants[index].body = newBody;
    newVariants[index].wordCount = newBody.split(" ").filter(Boolean).length;
    setVariants(newVariants);
  };

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          Cold Email Drafter
        </h3>
        {variants.length > 0 && (
          <button
            onClick={() => generateEmails(tone)}
            disabled={loading}
            className="px-4 py-2 border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm transition disabled:opacity-50"
          >
            {loading ? "Regenerating..." : "Regenerate"}
          </button>
        )}
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-zinc-400">Recipient Type:</span>
          <select
            value={variantType}
            onChange={(event) => setVariantType(event.target.value as RecipientVariant)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            {RECIPIENT_VARIANTS.map((variant) => (
              <option key={variant} value={variant}>
                {variant}
              </option>
            ))}
          </select>
        </div>
        {!variants.length && (
          <button
            onClick={() => generateEmails(tone)}
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold transition shadow-lg shadow-blue-500/20"
          >
            {loading ? "Drafting Emails..." : "Generate Email Variants"}
          </button>
        )}
      </div>

      {variants.length > 0 && (
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2">
            {TONES.map((t) => (
              <button
                key={t}
                onClick={() => handleToneChange(t)}
                className={`px-3 py-1.5 rounded-md text-sm capitalize border ${tone === t ? "bg-blue-600 text-white border-blue-500" : "bg-zinc-800 text-zinc-300 border-zinc-700"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && variants.length > 0 && <span className="block text-sm text-blue-400">Regenerating with {tone} tone...</span>}

      {variants.length > 0 && activeVariant && (
        <div className="grid grid-cols-1 gap-6">
          {(() => {
            const toneKey = (
              activeVariant._tone && TONES.includes(activeVariant._tone as Tone)
                ? activeVariant._tone
                : tone
            ) as Tone;
            const mailtoLink = `mailto:${recruiter.email || ""}?subject=${encodeURIComponent(activeVariant.subject)}&body=${encodeURIComponent(activeVariant.body)}`;
            return (
              <div key={toneKey} className={`rounded-xl border ${sentStatus[toneKey] ? "border-green-500/50 bg-green-900/10" : "border-zinc-700/60 bg-zinc-800/40"} p-5 flex flex-col shadow-sm`}>
                <div className="flex justify-between items-start mb-3">
                  <div className="space-y-1">
                    <span className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-zinc-700 text-zinc-300 capitalize mr-2">
                       {toneKey}
                    </span>
                    <span className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-indigo-900/50 text-indigo-300 capitalize border border-indigo-700/50">
                       Hook: {activeVariant.hookType?.replace("-", " ")}
                    </span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${activeVariant.wordCount > 120 ? 'bg-red-900/50 text-red-300' : 'bg-zinc-700/50 text-zinc-400'}`}>
                    {activeVariant.wordCount} words
                  </span>
                </div>

                <div className="mb-4">
                  <span className="text-xs text-zinc-500 font-semibold tracking-wider block mb-1">SUBJECT</span>
                  <div className="font-medium text-white">{activeVariant.subject}</div>
                </div>

                <div className="mb-4 flex-grow">
                  <span className="text-xs text-zinc-500 font-semibold tracking-wider flex justify-between items-center mb-2">
                    BODY
                    <button
                      onClick={() => setEditingTone(editingTone === toneKey ? null : toneKey)}
                      className="text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded bg-blue-900/20"
                    >
                      {editingTone === toneKey ? "Done" : "Edit Element"}
                    </button>
                  </span>
                  {editingTone === toneKey ? (
                    <textarea
                      value={activeVariant.body}
                      onChange={(e) => updateBody(toneKey, e.target.value)}
                      className="w-full h-40 bg-zinc-950/80 text-zinc-300 border border-zinc-700/80 rounded block p-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  ) : (
                    <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{activeVariant.body}</div>
                  )}
                </div>

                <div className="mt-auto pt-4 border-t border-zinc-700/60 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300 group">
                    <input
                      type="checkbox"
                      checked={!!sentStatus[toneKey]}
                      onChange={() => handleSendStatus(toneKey)}
                      className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-green-500 focus:ring-green-600 focus:ring-offset-zinc-800"
                    />
                    <span className="group-hover:text-white transition">Mark as Sent</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(activeVariant.body)}
                      className="px-3 py-1.5 bg-zinc-700/60 hover:bg-zinc-600 text-zinc-200 text-xs font-medium rounded transition flex items-center gap-1.5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      Copy
                    </button>
                    <a
                      href={mailtoLink}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded transition flex items-center gap-1.5 shadow-sm"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      Open in Gmail
                    </a>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
