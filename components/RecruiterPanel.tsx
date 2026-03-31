"use client";

import { useToast } from "@/components/ToastProvider";
import { ApiResponse, RecruiterProfile } from "@/types";
import { useEffect, useState } from "react";

interface RecruiterPanelProps {
  jobId: string;
  company: string;
  role: string;
  jobDescription: string;
  autoResearchToken?: number;
  hideHeaderButton?: boolean;
  onProfilesFound?: (profiles: RecruiterProfile[]) => void;
}

const LOADING_STEPS = [
  "Analyzing JD for department and keywords...",
  "Building targeted LinkedIn search queries...",
  "Searching web and parsing LinkedIn snippets...",
  "Synthesizing results with Claude to find top contacts...",
];

export default function RecruiterPanel({
  jobId,
  company,
  role,
  jobDescription,
  autoResearchToken,
  hideHeaderButton,
  onProfilesFound,
}: RecruiterPanelProps) {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<RecruiterProfile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  interface EmailResult {
    email: string;
    confidence: number;
    method: string;
    verified: boolean;
  }
  const [emailFinding, setEmailFinding] = useState<Record<string, boolean>>({});
  const [emailResults, setEmailResults] = useState<Record<string, EmailResult | null>>({});

  // Simulate loading steps visually
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      setLoadingStep(0);
      interval = setInterval(() => {
        setLoadingStep((prev) => Math.min(prev + 1, LOADING_STEPS.length - 1));
      }, 4000); // Change step text every 4 seconds
    }
    return () => clearInterval(interval);
  }, [loading]);

  const handleResearch = async () => {
    if (!jobDescription) {
      setError("Please provide a job description before analyzing.");
      return;
    }
    setLoading(true);
    setError(null);
    setProfiles(null);

    try {
      const res = await fetch("/api/recruiter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, company, role, jobDescription }),
      });

      const data: ApiResponse<RecruiterProfile[]> = await res.json();
      
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to find recruiters");
      }

      setProfiles(data.data || []);
      onProfilesFound?.(data.data || []);
      toast(`Found ${data.data?.length || 0} recruiter profiles`, "success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
      toast(message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoResearchToken !== undefined && autoResearchToken > 0) {
      handleResearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResearchToken]);

  const handleFindEmail = async (profileKey: string, profile: RecruiterProfile) => {
    setEmailFinding((prev) => ({ ...prev, [profileKey]: true }));
    try {
      const res = await fetch("/api/recruiter/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recruiterProfile: profile, company, jobId }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.data) {
        setEmailResults((prev) => ({ ...prev, [profileKey]: data.data }));
        if (data.data.email) {
          toast("Recruiter email found", "success");
        } else {
          toast("No recruiter email found", "info");
        }
      } else {
        setEmailResults((prev) => ({ ...prev, [profileKey]: null }));
        toast("Could not resolve recruiter email", "error");
      }
    } catch {
      setEmailResults((prev) => ({ ...prev, [profileKey]: null }));
      toast("Email lookup failed", "error");
    } finally {
      setEmailFinding((prev) => ({ ...prev, [profileKey]: false }));
    }
  };

  const manualSearchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
    company + " (recruiter OR talent acquisition OR hiring manager)"
  )}`;

  const getConfidenceColor = (score: number) => {
    if (score >= 80) return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800/30";
    if (score >= 50) return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800/30";
    return "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 80) return "High Match";
    if (score >= 50) return "Medium Match";
    return "Low Match";
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Recruiter Research Engine</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Autonomous web search to find the right people to cold email.</p>
        </div>
        {!loading && !hideHeaderButton && (
          <button
            onClick={handleResearch}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
            {profiles ? "Run Again" : "Find Recruiters"}
          </button>
        )}
      </div>

      <div className="p-6">
        {loading ? (
          <div className="space-y-4">
            <h3 className="text-base font-medium text-slate-900 dark:text-white">Researching {company}...</h3>
            <div className="text-sm text-blue-600 dark:text-blue-400 font-medium animate-pulse">
              {LOADING_STEPS[loadingStep]}
            </div>
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={`recruiter_skeleton_${index}`} className="rounded-xl border border-slate-200 dark:border-slate-800 p-5">
                <div className="mb-3 h-5 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="mb-2 h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-900/50 text-sm">
            {error}
          </div>
        ) : profiles && profiles.length > 0 ? (
          <div className="space-y-4">
            {profiles.map((profile, i) => {
              const profileKey = `${profile.name}-${profile.title}-${i}`;
              return (
                <div key={profileKey} className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        {profile.name}
                        <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${getConfidenceColor(profile.confidence || 0)}`}>
                          {getConfidenceLabel(profile.confidence || 0)}
                        </span>
                      </h3>
                      <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mt-1">{profile.title}</p>
                    </div>
                    
                    <div className="flex gap-2">
                      {profile.linkedinUrl && profile.linkedinUrl !== "null" && profile.linkedinUrl !== "empty" && (
                        <a
                          href={profile.linkedinUrl.startsWith('http') ? profile.linkedinUrl : `https://${profile.linkedinUrl}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-lg transition-colors border border-slate-200 dark:border-slate-700 flex items-center gap-1.5"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect width="4" height="12" x="2" y="9"></rect><circle cx="4" cy="4" r="2"></circle></svg>
                          LinkedIn
                        </a>
                      )}
                      <button
                        onClick={() => handleFindEmail(profileKey, profile)}
                        disabled={emailFinding[profileKey]}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 text-xs font-medium rounded-lg transition-colors border border-indigo-200 dark:border-indigo-800/50 flex items-center gap-1.5 disabled:opacity-50"
                      >
                        {emailFinding[profileKey] ? (
                          <>
                            <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin"></div>
                            Finding...
                          </>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg>
                            Find Email
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  
                  {emailResults[profileKey] !== undefined && (
                    <div className="mb-4">
                      {emailResults[profileKey] && emailResults[profileKey]?.email ? (
                        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800/30 flex justify-between items-center text-sm">
                          <div className="flex items-center gap-3">
                            <span className="font-medium text-slate-800 dark:text-slate-200">{emailResults[profileKey]!.email}</span>
                            <span className={`${emailResults[profileKey]!.verified ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400'} px-2 py-0.5 rounded text-xs font-semibold`}>
                              {emailResults[profileKey]!.verified ? "Verified" : "Unverified"}
                            </span>
                            <span className="text-slate-500 dark:text-slate-400 text-xs">Score: {Math.round(emailResults[profileKey]!.confidence)}%</span>
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(emailResults[profileKey]!.email);
                              toast("Email copied", "success");
                            }}
                            className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                            title="Copy Email"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>
                          </button>
                        </div>
                      ) : (
                        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg>
                          Not found via Hunter.io — try LinkedIn InMail
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 border border-slate-100 dark:border-slate-800/50 text-xs text-slate-600 dark:text-slate-400 leading-relaxed italic">
                    <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5 not-italic">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" x2="8" y1="13" y2="13"></line><line x1="16" x2="8" y1="17" y2="17"></line><line x1="10" x2="8" y1="9" y2="9"></line></svg>
                      Source Snippet
                    </div>
                    &quot;{profile.source}&quot;
                  </div>
                </div>
              );
            })}
          </div>
        ) : profiles && profiles.length === 0 ? (
          <div className="text-center py-10 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800/50">
            <div className="w-12 h-12 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-500">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path><line x1="11" x2="11" y1="8" y2="14"></line><line x1="8" x2="14" y1="11" y2="11"></line></svg>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">No definitive contacts found</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto mb-4">
              We couldn&apos;t lock onto a high-confidence match using the API. You might have better luck searching directly on LinkedIn.
            </p>
            <a 
              href={manualSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium rounded-lg hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
            >
              Manual Search on LinkedIn
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" x2="21" y1="14" y2="3"></line></svg>
            </a>
          </div>
        ) : (
          <div className="text-center py-12 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-4 text-slate-300 dark:text-slate-700"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>
            <p className="text-sm max-w-sm">Tap &quot;Find Recruiters&quot; to scour the web for the best hiring managers or recruiters to contact for this role.</p>
          </div>
        )}
      </div>
    </div>
  );
}
