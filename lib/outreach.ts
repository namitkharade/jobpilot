import { createHash } from "crypto";

import {
  JobListing,
  OutreachBrief,
  OutreachChannel,
  OutreachDraft,
  OutreachResponseData,
  RecruiterCandidate,
} from "@/types";
import { getSelectedRecruiterCandidate, projectLegacyRecruiterFields } from "./job-normalize";
import { getPreferredChannel } from "./recruiter-intelligence";
import { getOpenAIModel, getResumeCacheStatus, runStructuredResponse } from "./openai";

const DEFAULT_TONES = ["professional", "conversational", "direct"] as const;

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "highlights", "requirements", "groundingUrls"],
  properties: {
    summary: { type: "string" },
    highlights: {
      type: "array",
      items: { type: "string" },
    },
    requirements: {
      type: "array",
      items: { type: "string" },
    },
    groundingUrls: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["drafts"],
  properties: {
    drafts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tone", "subject", "body", "hookType", "cta", "groundingUrls"],
        properties: {
          tone: {
            type: "string",
            enum: [...DEFAULT_TONES],
          },
          subject: { type: "string" },
          body: { type: "string" },
          hookType: { type: "string" },
          cta: { type: "string" },
          groundingUrls: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

function hashString(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function getWordCount(body: string): number {
  return body.split(/\s+/).filter(Boolean).length;
}

function resolveOutreachCandidate(job: JobListing, candidateId?: string): RecruiterCandidate | null {
  if (candidateId) {
    return job.recruiterCandidates.find((candidate) => candidate.id === candidateId) || null;
  }
  return getSelectedRecruiterCandidate(job);
}

function resolveChannel(candidate: RecruiterCandidate | null, preferredChannel?: "email" | "linkedin"): OutreachChannel {
  if (!candidate) return "blocked";

  if (preferredChannel === "email") {
    return candidate.email && (candidate.emailVerificationStatus === "valid" || candidate.emailVerificationStatus === "accept_all")
      ? "email"
      : "blocked";
  }

  if (preferredChannel === "linkedin") {
    return candidate.linkedinUrl ? "linkedin" : "blocked";
  }

  return getPreferredChannel(candidate);
}

function buildBriefKey(job: JobListing, candidateId: string, channel: OutreachChannel, resumeUpdatedAt: string): string {
  return hashString([
    job.id,
    candidateId,
    channel,
    resumeUpdatedAt,
    hashString(job.jobDescription || ""),
  ].join(":"));
}

function buildGroundingUrls(job: JobListing, candidate: RecruiterCandidate): string[] {
  return Array.from(
    new Set([
      ...candidate.evidence.map((entry) => entry.url),
      ...(job.companyIntel?.signals || []).map((entry) => entry.url),
    ].filter(Boolean))
  );
}

async function buildOutreachBrief(
  job: JobListing,
  candidate: RecruiterCandidate,
  channel: OutreachChannel,
  forceRefreshBrief = false
): Promise<OutreachBrief | null> {
  if (channel === "blocked") return null;

  const resume = getResumeCacheStatus();
  const briefKey = buildBriefKey(job, candidate.id, channel, resume.updatedAt || "");
  if (!forceRefreshBrief && job.outreach.brief && job.outreach.brief.key === briefKey) {
    return job.outreach.brief;
  }

  const baseGroundingUrls = buildGroundingUrls(job, candidate);

  try {
    const result = await runStructuredResponse<{
      summary: string;
      highlights: string[];
      requirements: string[];
      groundingUrls: string[];
    }>({
      schemaName: "outreach_brief",
      schema: BRIEF_SCHEMA,
      instructions:
        "Build a grounded outreach brief. Use only the supplied company and candidate evidence. Do not invent initiatives, mutual connections, or personal familiarity.",
      input: [
        `Role: ${job.title} at ${job.company}`,
        `Channel: ${channel}`,
        `Candidate: ${candidate.name}, ${candidate.title}`,
        `Resume summary:\n${resume.text.slice(0, 6000) || "Not available"}`,
        `ATS keyword gaps: ${job.atsKeywordGaps.join(", ") || "Not available"}`,
        `ATS suggestions: ${(job.atsSuggestions || []).map((suggestion) => suggestion.suggested).slice(0, 4).join(" | ") || "Not available"}`,
        `Job description:\n${job.jobDescription.slice(0, 8000)}`,
        `Company intel:\n${job.companyIntel?.description || job.companyDescription || "Not available"}`,
        `Company evidence:\n${(job.companyIntel?.signals || [])
          .map((signal) => `- ${signal.title}: ${signal.snippet} (${signal.url})`)
          .join("\n") || "None"}`,
        `Candidate evidence:\n${candidate.evidence
          .map((signal) => `- ${signal.title}: ${signal.snippet} (${signal.url})`)
          .join("\n") || "None"}`,
        `Allowed grounding URLs: ${baseGroundingUrls.join(", ") || "None"}`,
      ].join("\n\n"),
      model: getOpenAIModel("draft"),
      allowChatFallback: true,
    });

    return {
      key: briefKey,
      candidateId: candidate.id,
      channel,
      summary: result.data.summary,
      highlights: result.data.highlights,
      requirements: result.data.requirements,
      groundingUrls: result.data.groundingUrls.length ? result.data.groundingUrls : baseGroundingUrls,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      key: briefKey,
      candidateId: candidate.id,
      channel,
      summary: `${job.title} at ${job.company}`,
      highlights: (resume.text || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 10)
        .slice(0, 4),
      requirements: job.atsKeywordGaps.slice(0, 4),
      groundingUrls: baseGroundingUrls,
      updatedAt: new Date().toISOString(),
    };
  }
}

async function generateDrafts(
  job: JobListing,
  candidate: RecruiterCandidate,
  channel: "email" | "linkedin",
  brief: OutreachBrief,
  tones: readonly ("professional" | "conversational" | "direct")[],
  forceRegenerateDrafts = false
): Promise<OutreachDraft[]> {
  const existingDrafts = job.outreach.drafts.filter(
    (draft) => draft.candidateId === candidate.id && draft.channel === channel
  );
  const existingByTone = new Map(existingDrafts.map((draft) => [draft.tone, draft]));

  if (
    !forceRegenerateDrafts &&
    existingDrafts.length >= tones.length &&
    tones.every((tone) => existingByTone.has(tone)) &&
    job.outreach.brief?.key === brief.key
  ) {
    return tones.map((tone) => existingByTone.get(tone)!).filter(Boolean);
  }

  const bodyRule =
    channel === "email"
      ? "Generate exactly 3 email drafts. Keep each body between 70 and 110 words. Provide a subject line."
      : "Generate exactly 3 LinkedIn message drafts. Keep each body between 280 and 450 characters. Leave subject as an empty string.";

  const ctaRule =
    channel === "email"
      ? "Use a specific low-friction CTA for a short conversation."
      : "Use a softer CTA suitable for LinkedIn, without sounding like a job application form letter.";

  const result = await runStructuredResponse<{
    drafts: Array<{
      tone: "professional" | "conversational" | "direct";
      subject: string;
      body: string;
      hookType: string;
      cta: string;
      groundingUrls: string[];
    }>;
  }>({
    schemaName: "outreach_drafts",
    schema: DRAFT_SCHEMA,
    instructions:
      "Write grounded outreach drafts only from the provided brief. If evidence is sparse, use a direct role-and-fit opening instead of pretending familiarity.",
    input: [
      `Channel: ${channel}`,
      `Role: ${job.title} at ${job.company}`,
      `Recipient: ${candidate.name}, ${candidate.title}`,
      `Brief summary: ${brief.summary}`,
      `Highlights: ${brief.highlights.join(" | ") || "None"}`,
      `Requirements: ${brief.requirements.join(" | ") || "None"}`,
      `Grounding URLs: ${brief.groundingUrls.join(", ") || "None"}`,
      `Requested tones: ${tones.join(", ")}`,
      bodyRule,
      ctaRule,
    ].join("\n\n"),
    model: getOpenAIModel("draft"),
    allowChatFallback: true,
  });

  return result.data.drafts
    .filter((draft) => tones.includes(draft.tone))
    .map((draft) => ({
      id: `draft_${hashString(`${candidate.id}:${channel}:${draft.tone}:${draft.body}`)}`,
      candidateId: candidate.id,
      channel,
      tone: draft.tone,
      subject: channel === "email" ? draft.subject : "",
      body: draft.body,
      wordCount: getWordCount(draft.body),
      hookType: draft.hookType,
      cta: draft.cta,
      groundingUrls: draft.groundingUrls.length ? draft.groundingUrls : brief.groundingUrls,
      generatedAt: new Date().toISOString(),
      sentAt: null,
    }));
}

export async function generateOutreach(
  job: JobListing,
  options: {
    candidateId?: string;
    preferredChannel?: "email" | "linkedin";
    tones?: Array<"professional" | "conversational" | "direct">;
    forceRefreshBrief?: boolean;
    forceRegenerateDrafts?: boolean;
  } = {}
): Promise<{
  response: OutreachResponseData;
  updates: Partial<JobListing>;
}> {
  const candidate = resolveOutreachCandidate(job, options.candidateId);
  const channel = resolveChannel(candidate, options.preferredChannel);

  if (!candidate || channel === "blocked") {
    const nextOutreach = {
      ...job.outreach,
      status: "blocked" as const,
      preferredChannel: "blocked" as const,
      selectedDraftId: "",
      lastDraftedAt: job.outreach.lastDraftedAt,
    };

    return {
      response: {
        candidate,
        preferredChannel: "blocked",
        drafts: [],
        briefSummary: "",
        selectedDraftId: "",
      },
      updates: {
        outreach: nextOutreach,
        ...projectLegacyRecruiterFields({
          recruiterCandidates: job.recruiterCandidates,
          selectedRecruiterId: job.selectedRecruiterId,
          outreach: nextOutreach,
        }),
      },
    };
  }

  const tones = options.tones && options.tones.length ? options.tones : [...DEFAULT_TONES];
  const brief = await buildOutreachBrief(job, candidate, channel, options.forceRefreshBrief);
  if (!brief) {
    throw new Error("Failed to build outreach brief");
  }

  const drafts = await generateDrafts(job, candidate, channel, brief, tones, options.forceRegenerateDrafts);
  const selectedDraftId =
    drafts.find((draft) => draft.tone === "professional")?.id ||
    drafts[0]?.id ||
    "";

  const nextDrafts = [
    ...job.outreach.drafts.filter(
      (draft) => !(draft.candidateId === candidate.id && draft.channel === channel)
    ),
    ...drafts,
  ];

  const nextOutreach = {
    ...job.outreach,
    status: "drafted" as const,
    preferredChannel: channel,
    selectedDraftId,
    drafts: nextDrafts,
    brief,
    lastDraftedAt: new Date().toISOString(),
  };

  return {
    response: {
      candidate,
      preferredChannel: channel,
      drafts,
      briefSummary: brief.summary,
      selectedDraftId,
    },
    updates: {
      outreach: nextOutreach,
      ...projectLegacyRecruiterFields({
        recruiterCandidates: job.recruiterCandidates,
        selectedRecruiterId: job.selectedRecruiterId,
        outreach: nextOutreach,
      }),
    },
  };
}

export function buildOutreachSentUpdate(job: JobListing, draftId: string): Partial<JobListing> {
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
  const nextOutreach = {
    ...job.outreach,
    status: "sent" as const,
    selectedDraftId: draftId,
    preferredChannel: selectedDraft?.channel || job.outreach.preferredChannel,
    drafts,
    lastSentAt: sentAt,
  };

  return {
    outreach: nextOutreach,
    ...projectLegacyRecruiterFields({
      recruiterCandidates: job.recruiterCandidates,
      selectedRecruiterId: job.selectedRecruiterId,
      outreach: nextOutreach,
    }),
  };
}
