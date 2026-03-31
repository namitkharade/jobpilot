"use client";

import { useToast } from "@/components/ToastProvider";
import { JobListing, RecruiterProfile } from "@/types";
import { useState } from "react";

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

export default function EmailDrafter({
  jobId,
  recruiter,
  jobListing,
  resumeSummary,
}: EmailDrafterProps) {
  const { toast } = useToast();
  const TONES = ["professional", "conversational", "direct"] as const;
  type Tone = (typeof TONES)[number];
  const [tone, setTone] = useState<Tone>("professional");
  const [variants, setVariants] = useState<EmailVariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [sentStatus, setSentStatus] = useState<Record<number, boolean>>({});

  const generateEmails = async (selectedTone: string) => {
    setLoading(true);
    try {
      // The instructions say variant: 'recruiter' | 'hiring-manager' | 'department-head'
      let variantType = "recruiter";
      if (recruiter.title.toLowerCase().includes("manager") || recruiter.title.toLowerCase().includes("director")) variantType = "hiring-manager";
      if (recruiter.title.toLowerCase().includes("head") || recruiter.title.toLowerCase().includes("vp") || recruiter.title.toLowerCase().includes("chief")) variantType = "department-head";

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
        setEditingIndex(null);
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

  const handleToneChange = (newTone: typeof tone) => {
    setTone(newTone);
    generateEmails(newTone);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast("Email copied", "success");
  };

  const handleSendStatus = async (index: number) => {
    const isSent = !sentStatus[index];
    setSentStatus((prev) => ({ ...prev, [index]: isSent }));

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

  const updateBody = (index: number, newBody: string) => {
    const newVariants = [...variants];
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

      {!variants.length && (
        <button
          onClick={() => generateEmails(tone)}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold transition shadow-lg shadow-blue-500/20"
        >
          {loading ? "Drafting Emails..." : "Generate Email Variants"}
        </button>
      )}

      {variants.length > 0 && (
        <div className="flex items-center gap-6 mb-4">
          <span className="text-sm font-medium text-zinc-400">Tone:</span>
          {TONES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm text-zinc-300 font-medium cursor-pointer">
              <input
                type="radio"
                name="tone"
                value={t}
                checked={tone === t}
                onChange={() => handleToneChange(t)}
                className="w-4 h-4 text-blue-500 bg-zinc-800 border-zinc-700 focus:ring-blue-500"
              />
              <span className="capitalize">{t}</span>
            </label>
          ))}
        </div>
      )}

      {loading && variants.length > 0 && <span className="block text-sm text-blue-400">Regenerating with {tone} tone...</span>}

      {variants.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {variants.map((variant, idx) => {
            const mailtoLink = `mailto:${recruiter.email || ""}?subject=${encodeURIComponent(variant.subject)}&body=${encodeURIComponent(variant.body)}`;
            return (
              <div key={idx} className={`rounded-xl border ${sentStatus[idx] ? "border-green-500/50 bg-green-900/10" : "border-zinc-700/60 bg-zinc-800/40"} p-5 flex flex-col shadow-sm`}>
                <div className="flex justify-between items-start mb-3">
                  <div className="space-y-1">
                    <span className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-zinc-700 text-zinc-300 capitalize mr-2">
                       {variant._tone || tone}
                    </span>
                    <span className="inline-block px-2.5 py-0.5 rounded text-xs font-semibold bg-indigo-900/50 text-indigo-300 capitalize border border-indigo-700/50">
                       Hook: {variant.hookType?.replace("-", " ")}
                    </span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${variant.wordCount > 120 ? 'bg-red-900/50 text-red-300' : 'bg-zinc-700/50 text-zinc-400'}`}>
                    {variant.wordCount} words
                  </span>
                </div>

                <div className="mb-4">
                  <span className="text-xs text-zinc-500 font-semibold tracking-wider block mb-1">SUBJECT</span>
                  <div className="font-medium text-white">{variant.subject}</div>
                </div>

                <div className="mb-4 flex-grow">
                  <span className="text-xs text-zinc-500 font-semibold tracking-wider flex justify-between items-center mb-2">
                    BODY
                    <button
                      onClick={() => setEditingIndex(editingIndex === idx ? null : idx)}
                      className="text-blue-400 hover:text-blue-300 transition-colors px-2 py-1 rounded bg-blue-900/20"
                    >
                      {editingIndex === idx ? "Done" : "Edit Element"}
                    </button>
                  </span>
                  {editingIndex === idx ? (
                    <textarea
                      value={variant.body}
                      onChange={(e) => updateBody(idx, e.target.value)}
                      className="w-full h-40 bg-zinc-950/80 text-zinc-300 border border-zinc-700/80 rounded block p-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  ) : (
                    <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{variant.body}</div>
                  )}
                </div>

                <div className="mt-auto pt-4 border-t border-zinc-700/60 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300 group">
                    <input
                      type="checkbox"
                      checked={!!sentStatus[idx]}
                      onChange={() => handleSendStatus(idx)}
                      className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-green-500 focus:ring-green-600 focus:ring-offset-zinc-800"
                    />
                    <span className="group-hover:text-white transition">Mark as Sent</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleCopy(variant.body)}
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
          })}
        </div>
      )}
    </div>
  );
}
