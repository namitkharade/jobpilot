"use client";

import { AtsResult } from "@/types";
import clsx from "clsx";
import { useState } from "react";

interface AtsScoreCardProps {
  result: AtsResult | null;
  loading?: boolean;
  onAnalyze?: () => void;
}

export default function AtsScoreCard({ result, loading, onAnalyze }: AtsScoreCardProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  if (!result && !loading) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
            ATS Analysis
          </h3>
          <span className="px-2 py-0.5 rounded-md bg-zinc-800/60 text-zinc-500 text-xs">
            Not analyzed
          </span>
        </div>
        <p className="text-zinc-600 text-sm mb-4">
          Save a base resume template to analyze ATS compatibility with this job.
        </p>
        {onAnalyze && (
          <button
            onClick={onAnalyze}
            className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all shadow-lg shadow-violet-500/20 hover:shadow-violet-500/40"
          >
            Analyze Resume
          </button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm p-6">
        <div className="space-y-4">
          <div className="h-5 w-40 animate-pulse rounded bg-zinc-700" />
          <div className="h-24 w-full animate-pulse rounded bg-zinc-800" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-12 animate-pulse rounded bg-zinc-800" />
            <div className="h-12 animate-pulse rounded bg-zinc-800" />
            <div className="h-12 animate-pulse rounded bg-zinc-800" />
            <div className="h-12 animate-pulse rounded bg-zinc-800" />
          </div>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpanded(newExpanded);
  };

  const getScoreColor = (score: number) => {
    if (score > 75) return "text-emerald-500";
    if (score >= 50) return "text-amber-500";
    return "text-red-500";
  };

  const getScoreBgColor = (score: number) => {
    if (score > 75) return "bg-emerald-500";
    if (score >= 50) return "bg-amber-500";
    return "bg-red-500";
  };

  const radius = 30;
  const circum = 2 * Math.PI * radius;
  const strokeDashoffset = circum - (result.score / 100) * circum;

  return (
    <div className="bg-zinc-900/40 backdrop-blur-sm rounded-2xl border border-zinc-800/60 p-6 flex flex-col gap-8 w-full">
      {/* Header & Score Chart */}
      <div className="flex flex-col md:flex-row items-center gap-8">
        <div className="w-24 h-24 relative flex-shrink-0">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 72 72">
            <circle
              className="text-zinc-800"
              strokeWidth="4"
              stroke="currentColor"
              fill="transparent"
              r={radius}
              cx="36"
              cy="36"
            />
            <circle
              className={`${getScoreColor(result.score)} transition-all duration-1000 ease-out`}
              strokeWidth="4"
              strokeDasharray={circum}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              stroke="currentColor"
              fill="transparent"
              r={radius}
              cx="36"
              cy="36"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center flex-col">
            <span className={clsx("text-2xl font-bold font-mono", getScoreColor(result.score))}>{result.score}</span>
          </div>
        </div>

        <div className="flex-1 text-center md:text-left">
          <h2 className="text-xl font-bold text-zinc-200 mb-2">ATS Match Analysis</h2>
          <p className="text-zinc-400 text-sm leading-relaxed">{result.summary}</p>
        </div>
      </div>

      {/* Score Breakdown Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: "Keyword Match", val: result.scoreBreakdown?.keywordMatch || 0 },
          { label: "Skills Alignment", val: result.scoreBreakdown?.skillsAlignment || 0 },
          { label: "Experience Relevance", val: result.scoreBreakdown?.experienceRelevance || 0 },
          { label: "Format Quality", val: result.scoreBreakdown?.formatQuality || 0 },
        ].map((item, idx) => (
          <div key={idx} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs font-semibold text-zinc-400">
              <span>{item.label}</span>
              <span>{item.val}%</span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${getScoreBgColor(item.val)} transition-all duration-1000`}
                style={{ width: `${item.val}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-800/60 my-2"></div>

      {/* Keywords */}
      <div className="flex flex-col gap-6">
        <div>
          <h3 className="text-sm font-semibold text-emerald-400 mb-3 uppercase tracking-wider">Matched Keywords</h3>
          <div className="flex flex-wrap gap-2">
            {result.matchedKeywords?.map((kw, i) => (
              <span
                key={i}
                className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-md border border-emerald-500/20"
              >
                {kw}
              </span>
            ))}
            {(!result.matchedKeywords || result.matchedKeywords.length === 0) && (
              <span className="text-zinc-500 text-sm italic">No matching keywords found.</span>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-rose-400 mb-3 uppercase tracking-wider">Missing Keywords</h3>
          <div className="flex flex-wrap gap-2">
            {result.missingKeywords?.map((kw, i) => (
              <span
                key={i}
                className="px-2.5 py-1 bg-rose-500/10 text-rose-400 text-xs font-medium rounded-md border border-rose-500/20"
              >
                {kw}
              </span>
            ))}
            {(!result.missingKeywords || result.missingKeywords.length === 0) && (
              <span className="text-zinc-500 text-sm italic">Good job! No major keywords missing.</span>
            )}
          </div>
        </div>
      </div>

      {/* Suggestions */}
      {result.suggestions && result.suggestions.length > 0 && (
        <div className="flex flex-col gap-4 mt-2">
          <h3 className="text-sm font-semibold text-violet-400 uppercase tracking-wider mb-1">Tailoring Suggestions</h3>
          {result.suggestions.map((sug, idx) => {
            const isExpanded = expanded.has(idx);
            return (
              <div
                key={idx}
                className="border border-zinc-700/50 rounded-lg overflow-hidden transition-all duration-200"
              >
                <div
                  className="bg-zinc-800/40 p-4 flex justify-between items-center cursor-pointer hover:bg-zinc-800/60"
                  onClick={() => toggleExpand(idx)}
                >
                  <div className="flex flex-col gap-1.5">
                    <span className="px-2 py-0.5 rounded w-max bg-violet-500/15 text-violet-400 text-[10px] font-bold uppercase tracking-wide">
                      {sug.section} Section
                    </span>
                    <span className="text-sm text-zinc-300 line-clamp-1">{sug.reason}</span>
                  </div>
                  <button className="text-zinc-400 hover:text-zinc-200">
                    <svg
                      className={`w-5 h-5 transform transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {isExpanded && (
                  <div className="p-4 bg-zinc-900/40 flex flex-col gap-4 border-t border-zinc-700/50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">Original Text</span>
                        <div className="p-3 bg-rose-500/5 text-rose-200 text-sm rounded border border-rose-500/10 line-through decoration-rose-500/50">
                          {sug.original}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Suggested Polish</span>
                        <div className="p-3 bg-emerald-500/5 text-emerald-200 text-sm rounded border border-emerald-500/10">
                          {sug.suggested}
                        </div>
                      </div>
                    </div>
                    {sug.keywordsAdded && sug.keywordsAdded.length > 0 && (
                      <div className="text-xs text-zinc-400 mt-2">
                        <span className="font-semibold text-zinc-300">Keywords added:</span>{" "}
                        <span className="text-violet-300">{sug.keywordsAdded.join(", ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
