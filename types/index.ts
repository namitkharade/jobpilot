export type JobStatus =
  | "saved"
  | "applied"
  | "interviewing"
  | "rejected"
  | "ghosted";

export type JobSource = "linkedin" | "indeed";

export type LinkedInTimeRange =
  | "any"
  | "past_1h"
  | "past_24h"
  | "past_48h"
  | "past_week"
  | "past_2weeks"
  | "past_month";

export type ResearchSourceType =
  | "legacy"
  | "job-poster"
  | "apply-url"
  | "hunter"
  | "openai-web"
  | "searxng"
  | "manual";

export type RecruiterCandidateRole =
  | "recruiter"
  | "hiring-manager"
  | "department-head"
  | "job-poster"
  | "legacy"
  | "unknown";

export type CandidateChannel = "email" | "linkedin";

export type EmailVerificationStatus =
  | "valid"
  | "accept_all"
  | "unknown"
  | "unverified"
  | "not_found";

export type OutreachChannel = CandidateChannel | "blocked";

export type OutreachStatus = "idle" | "researched" | "drafted" | "sent" | "blocked";

export interface AtsSuggestion {
  section: "summary" | "experience" | "skills" | "education";
  bulletIndex: number;
  original: string;
  suggested: string;
  reason: string;
  keywordsAdded: string[];
}

export interface AtsResult {
  score: number;
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

export interface ResearchEvidence {
  sourceType: ResearchSourceType;
  url: string;
  title: string;
  snippet: string;
  domain: string;
  extractedOn: string;
  lastSeenOn: string;
  stillOnPage: boolean;
}

export interface CompanyIntel {
  domain: string;
  description: string;
  industry: string;
  size: string;
  location: string;
  signals: ResearchEvidence[];
  updatedAt: string;
}

export interface RecruiterCandidate {
  id: string;
  name: string;
  title: string;
  role: RecruiterCandidateRole;
  linkedinUrl: string;
  linkedinHandle: string;
  email: string;
  emailVerificationStatus: EmailVerificationStatus;
  emailConfidence: number;
  domainPattern: string;
  channelOptions: CandidateChannel[];
  score: number;
  reasons: string[];
  sourceTypes: ResearchSourceType[];
  sourceSummary: string;
  evidence: ResearchEvidence[];
}

export interface OutreachDraft {
  id: string;
  candidateId: string;
  channel: CandidateChannel;
  tone: "professional" | "conversational" | "direct";
  subject: string;
  body: string;
  wordCount: number;
  hookType: string;
  cta: string;
  groundingUrls: string[];
  generatedAt: string;
  sentAt: string | null;
}

export interface OutreachBrief {
  key: string;
  candidateId: string;
  channel: OutreachChannel;
  summary: string;
  highlights: string[];
  requirements: string[];
  groundingUrls: string[];
  updatedAt: string;
}

export interface OutreachState {
  status: OutreachStatus;
  preferredChannel: OutreachChannel;
  selectedDraftId: string;
  drafts: OutreachDraft[];
  brief: OutreachBrief | null;
  lastResearchedAt: string;
  lastDraftedAt: string;
  lastSentAt: string;
}

export interface JobTargetProfile {
  discipline: string;
  department: string;
  targetTitles: string[];
  seniorityHint: string;
  keywords: string[];
  locationHint: string;
  roleFamily: string;
}

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
  companyDomain: string;
  companyIntel: CompanyIntel | null;
  recruiterCandidates: RecruiterCandidate[];
  selectedRecruiterId: string;
  outreach: OutreachState;
  recruiterName: string;
  recruiterTitle: string;
  recruiterProfileUrl: string;
  recruiterEmail: string;
  emailDraft: string;
  jobPosterName: string;
  jobPosterTitle: string;
  source: JobSource;
}

export interface RecruiterProfile {
  name: string;
  title: string;
  linkedinUrl: string;
  email: string;
  confidence: number;
  source: string;
}

export interface RecruiterResearchResult {
  companyDomain: string;
  companyIntel: CompanyIntel | null;
  candidates: RecruiterCandidate[];
  selectedRecruiterId: string;
  lastResearchedAt: string;
}

export interface OutreachResponseData {
  candidate: RecruiterCandidate | null;
  preferredChannel: OutreachChannel;
  drafts: OutreachDraft[];
  briefSummary: string;
  selectedDraftId: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
