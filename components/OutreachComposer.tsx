"use client";

import { useToast } from "@/components/ToastProvider";
import { getSelectedRecruiterCandidate } from "@/lib/job-normalize";
import { JobListing, OutreachDraft } from "@/types";
import { useEffect, useMemo, useState } from "react";

interface OutreachComposerProps {
  job: JobListing;
  onRefresh?: () => Promise<void> | void;
}

const TONES = ["professional", "conversational", "direct"] as const;

function buildLinkedInFallbackUrl(job: JobListing, title: string) {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${job.company} ${title || job.title}`)}`;
}

function getPreferredChannel(candidate: ReturnType<typeof getSelectedRecruiterCandidate>) {
  if (!candidate) return "blocked" as const;
  if (
    candidate.email &&
    (candidate.emailVerificationStatus === "valid" || candidate.emailVerificationStatus === "accept_all")
  ) {
    return "email" as const;
  }
  if (candidate.linkedinUrl) {
    return "linkedin" as const;
  }
  return "blocked" as const;
}

function buildSentUpdate(job: JobListing, draftId: string) {
  const sentAt = new Date().toISOString();
  const drafts = job.outreach.drafts.map((draft) =>
    draft.id === draftId
      ? {
          ...draft,
          sentAt,
        }
      : draft
  );
  const selectedDraft = drafts.find((draft) => draft.id === draftId);

  return {
    outreach: {
      ...job.outreach,
      status: "sent" as const,
      selectedDraftId: draftId,
      preferredChannel: selectedDraft?.channel || job.outreach.preferredChannel,
      drafts,
      lastSentAt: sentAt,
    },
  };
}

export default function OutreachComposer({ job, onRefresh }: OutreachComposerProps) {
  const { toast } = useToast();
  const selectedCandidate = useMemo(() => getSelectedRecruiterCandidate(job), [job]);
  const defaultChannel = useMemo(() => getPreferredChannel(selectedCandidate), [selectedCandidate]);
  const [preferredChannel, setPreferredChannel] = useState<"email" | "linkedin" | "blocked">(defaultChannel);
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [selectedTone, setSelectedTone] = useState<(typeof TONES)[number]>("professional");
  const [briefSummary, setBriefSummary] = useState(job.outreach.brief?.summary || "");
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    setPreferredChannel(defaultChannel);
  }, [defaultChannel]);

  useEffect(() => {
    if (!selectedCandidate) {
      setDrafts([]);
      return;
    }

    const nextDrafts = job.outreach.drafts.filter(
      (draft) => draft.candidateId === selectedCandidate.id && draft.channel === preferredChannel
    );
    setDrafts(nextDrafts);
    setBriefSummary(job.outreach.brief?.candidateId === selectedCandidate.id ? job.outreach.brief.summary : "");
  }, [job.outreach, preferredChannel, selectedCandidate]);

  const activeDraft =
    drafts.find((draft) => draft.tone === selectedTone) ||
    drafts.find((draft) => draft.tone === "professional") ||
    drafts[0] ||
    null;

  const availableChannels = useMemo(() => {
    if (!selectedCandidate) return [] as Array<"email" | "linkedin">;
    const channels: Array<"email" | "linkedin"> = [];
    if (
      selectedCandidate.email &&
      (selectedCandidate.emailVerificationStatus === "valid" || selectedCandidate.emailVerificationStatus === "accept_all")
    ) {
      channels.push("email");
    }
    if (selectedCandidate.linkedinUrl) {
      channels.push("linkedin");
    }
    return channels;
  }, [selectedCandidate]);

  const loadDrafts = async (forceRegenerateDrafts = false) => {
    if (!selectedCandidate || preferredChannel === "blocked") return;

    if (forceRegenerateDrafts) {
      setRegenerating(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          candidateId: selectedCandidate.id,
          preferredChannel,
          tones: [...TONES],
          forceRefreshBrief: false,
          forceRegenerateDrafts,
        }),
      });

      const body = (await res.json()) as {
        success: boolean;
        data?: {
          preferredChannel: "email" | "linkedin" | "blocked";
          drafts: OutreachDraft[];
          briefSummary: string;
        };
        error?: string;
      };

      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error || "Failed to generate outreach");
      }

      setPreferredChannel(body.data.preferredChannel);
      setDrafts(body.data.drafts);
      setBriefSummary(body.data.briefSummary);
      setSelectedTone("professional");
      await onRefresh?.();
      toast(
        forceRegenerateDrafts ? "Drafts regenerated" : `${body.data.drafts.length} drafts ready`,
        "success"
      );
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : "Failed to generate outreach", "error");
    } finally {
      setLoading(false);
      setRegenerating(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard", "success");
  };

  const handleMarkSent = async (draftId: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: job.id,
          ...buildSentUpdate(job, draftId),
        }),
      });
      const body = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !body.success) {
        throw new Error(body.error || "Failed to update outreach state");
      }
      await onRefresh?.();
      setDrafts((current) =>
        current.map((draft) => (draft.id === draftId ? { ...draft, sentAt: new Date().toISOString() } : draft))
      );
      toast("Outreach marked as sent", "success");
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : "Failed to update outreach state", "error");
    }
  };

  if (!selectedCandidate) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-[var(--surface)] p-5 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Select a contact from the Contact Intelligence tab before generating outreach.
      </div>
    );
  }

  if (defaultChannel === "blocked" && availableChannels.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-[var(--surface)] p-5 dark:border-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          This contact does not have a verified email or LinkedIn profile yet. Refresh the contact from the Contact Intelligence tab or use manual search.
        </p>
        <a
          href={buildLinkedInFallbackUrl(job, selectedCandidate.title)}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Open LinkedIn Search
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200 bg-[var(--surface)] p-5 dark:border-zinc-800">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Outreach Composer</h3>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Drafting for {selectedCandidate.name}, {selectedCandidate.title}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {availableChannels.map((channel) => (
            <button
              key={channel}
              onClick={() => setPreferredChannel(channel)}
              className={`rounded-md px-3 py-2 text-xs font-medium transition ${
                preferredChannel === channel
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {channel === "email" ? "Email" : "LinkedIn"}
            </button>
          ))}
          <button
            onClick={() => loadDrafts(drafts.length > 0)}
            disabled={loading || regenerating}
            className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {loading ? "Drafting..." : regenerating ? "Regenerating..." : drafts.length ? "Regenerate" : "Generate Drafts"}
          </button>
        </div>
      </div>

      {!!briefSummary && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
          {briefSummary}
        </div>
      )}

      {drafts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {TONES.map((tone) => {
            const hasTone = drafts.some((draft) => draft.tone === tone);
            return (
              <button
                key={tone}
                disabled={!hasTone}
                onClick={() => setSelectedTone(tone)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition ${
                  selectedTone === tone
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {tone}
              </button>
            );
          })}
        </div>
      )}

      {!activeDraft ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Generate drafts once you’re happy with the selected contact.
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {activeDraft.tone}
            </span>
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {activeDraft.wordCount} words
            </span>
            <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              Hook: {activeDraft.hookType}
            </span>
            {activeDraft.sentAt && (
              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                Sent
              </span>
            )}
          </div>

          {preferredChannel === "email" && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Subject</div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{activeDraft.subject}</div>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Body</div>
            <div className="whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-200">{activeDraft.body}</div>
          </div>

          {!!activeDraft.groundingUrls.length && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Grounding</div>
              {activeDraft.groundingUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-900 dark:text-zinc-400 dark:decoration-zinc-700 dark:hover:text-zinc-100"
                >
                  {url}
                </a>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <button
              onClick={() => handleCopy(activeDraft.body)}
              className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Copy Draft
            </button>
            <button
              onClick={() => handleMarkSent(activeDraft.id)}
              className="rounded-md border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Mark as Sent
            </button>
            {preferredChannel === "email" && selectedCandidate.email && (
              <a
                href={`mailto:${selectedCandidate.email}?subject=${encodeURIComponent(activeDraft.subject)}&body=${encodeURIComponent(activeDraft.body)}`}
                className="rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Open Mail App
              </a>
            )}
            {preferredChannel === "linkedin" && (
              <a
                href={selectedCandidate.linkedinUrl || buildLinkedInFallbackUrl(job, selectedCandidate.title)}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Open LinkedIn
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
