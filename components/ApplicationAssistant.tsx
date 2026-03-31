"use client";

import { useToast } from "@/components/ToastProvider";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";

interface ApplicationAssistantProps {
  jobId: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
}

type AssistantRole = "user" | "assistant";

interface AssistantMessage {
  id: string;
  role: AssistantRole;
  content: string;
}

interface AssistantApiResponse {
  success: boolean;
  data?: {
    answer: string;
  };
  error?: string;
}

export default function ApplicationAssistant({
  jobId,
  jobTitle,
  company,
  jobDescription,
}: ApplicationAssistantProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const hasMessages = messages.length > 0;

  const title = useMemo(() => `${jobTitle} at ${company}`, [jobTitle, company]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, loading]);

  const clearChat = () => {
    setMessages([]);
    setQuestion("");
  };

  const copyAnswer = async (message: AssistantMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId((prev) => (prev === message.id ? null : prev)), 2000);
    } catch {
      toast("Failed to copy answer", "error");
    }
  };

  const askAssistant = async () => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const userMessage: AssistantMessage = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: "user",
      content: trimmed,
    };

    const history = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setLoading(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          question: trimmed,
          history,
        }),
      });

      const data = (await res.json()) as AssistantApiResponse;

      if (!res.ok || !data.success || !data.data) {
        throw new Error(data.error || "Failed to generate answer");
      }

      const assistantMessage: AssistantMessage = {
        id: `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        role: "assistant",
        content: data.data.answer,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to generate answer";
      toast(message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[70vh] min-h-[420px] flex-col rounded-lg border border-zinc-200 bg-[var(--surface)] dark:border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold">Application Assistant</h3>
          <p className="text-xs text-zinc-500">{title}</p>
        </div>
        <button
          onClick={clearChat}
          disabled={!hasMessages && !question.trim()}
          className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Clear chat
        </button>
      </div>

      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {!hasMessages && !loading && (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-400">
            Paste a question from an application form to get a ready-to-use answer based on your resume and this job.
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={clsx("flex", message.role === "user" ? "justify-end" : "justify-start")}
          >
            <article
              className={clsx(
                "max-w-[92%] rounded-lg border px-3 py-2 text-sm",
                message.role === "user"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              )}
            >
              <p className="whitespace-pre-wrap leading-6">{message.content}</p>

              {message.role === "assistant" && (
                <div className="mt-2 flex items-center justify-end gap-2">
                  {copiedId === message.id && <span className="text-xs text-emerald-500">Copied!</span>}
                  <button
                    onClick={() => copyAnswer(message)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 10h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
                    </svg>
                    Copy
                  </button>
                </div>
              )}
            </article>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="w-[92%] max-w-[92%] rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="h-3 w-24 animate-pulse rounded bg-zinc-300 dark:bg-zinc-700" />
              <div className="mt-2 h-3 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-end gap-2">
          <textarea
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Paste a question from the application form..."
            className="min-h-[84px] flex-1 resize rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-300 placeholder:text-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:ring-zinc-700"
          />
          <button
            onClick={askAssistant}
            disabled={loading || !question.trim()}
            className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {loading ? "Answering..." : "Answer This"}
          </button>
        </div>
        <p className="mt-2 line-clamp-1 text-xs text-zinc-500">
          Context source: {jobDescription ? "Job description + resume cache" : "Resume cache"}
        </p>
      </div>
    </div>
  );
}
