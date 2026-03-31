// ─── Job Status ──────────────────────────────────────────
export type JobStatus =
  | "saved"
  | "applied"
  | "interviewing"
  | "rejected"
  | "ghosted";

// ─── Job Source ──────────────────────────────────────────
export type JobSource = "linkedin" | "indeed";

// ─── LinkedIn Time Range ───────────────────────────────
export type LinkedInTimeRange =
  | "any"
  | "past_1h"
  | "past_24h"
  | "past_48h"
  | "past_week"
  | "past_2weeks"
  | "past_month";

// ─── Job Listing ─────────────────────────────────────────
export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  jobType: string;
  postedAt: string;
  scrapedAt: string;
  applyUrl: string;
  jobDescription: string;
  companyDescription: string;
  atsScore: number | null;
  atsKeywordGaps: string[];
  atsSuggestions: AtsSuggestion[];
  status: JobStatus;
  recruiterName: string;
  recruiterTitle: string;
  recruiterProfileUrl: string;
  recruiterEmail: string;
  emailDraft: string;
  jobPosterName: string;
  jobPosterTitle: string;
  source: JobSource;
}

// ─── ATS Result ──────────────────────────────────────────
export interface AtsSuggestion {
  section: "summary" | "experience" | "skills" | "education";
  bulletIndex: number;
  original: string;
  suggested: string;
  reason: string;
  keywordsAdded: string[];
}

export interface AtsResult {
  score: number; // 0-100
  matchedKeywords: string[];
  missingKeywords: string[];
  suggestions: AtsSuggestion[];
  scoreBreakdown: {
    keywordMatch: number;
    skillsAlignment: number;
    experienceRelevance: number;
    formatQuality: number;
  };
  topMissingSkills: string[];
  summary: string;
}

// ─── Recruiter Profile ──────────────────────────────────
export interface RecruiterProfile {
  name: string;
  title: string;
  linkedinUrl: string;
  email: string;
  confidence: number;
  source: string;
}

// ─── API Response Wrappers ──────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
