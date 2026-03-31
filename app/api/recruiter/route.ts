import { extractDomain, findRecruitersAndManagers } from "@/lib/hunter";
import { updateJob } from "@/lib/job-store";
import { getConfig } from "@/lib/local-store";
import { SearchResult, searchMultiple } from "@/lib/searxng";
import { RecruiterProfile } from "@/types";
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

// Remove global client to ensure we always use the latest config-based API key
// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

function getOpenAIClient() {
  const config = getConfig();
  const apiKey = config.apiKeys.openai;
  if (!apiKey) throw new Error("OpenAI API key missing");
  return new OpenAI({ apiKey });
}

async function extractInfo(jobDescription: string) {
  const client = getOpenAIClient();

  const prompt = `Extract from this job description: (1) the department/team name, (2) likely seniority of the hiring manager (Director/VP/Head of/Manager), (3) 3 keywords that describe the team's function. Return JSON with the exact shape {"department":"...","managerLevel":"...","teamKeywords":[...]}.

Response Format:
{
  "department": "string",
  "managerLevel": "string",
  "teamKeywords": ["string", "string", "string"]
}`;
  
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are an expert recruitment analyst. Respond with ONLY a valid JSON object." },
      { role: "user", content: `JOB DESCRIPTION:\n${jobDescription}\n\n${prompt}` }
    ],
    max_tokens: 1000
  });

  const text = response.choices[0].message.content ?? "{}";
  try {
    const { department, managerLevel, teamKeywords } = JSON.parse(text);
    return {
      department: typeof department === "string" ? department : "",
      managerLevel: typeof managerLevel === "string" ? managerLevel : "",
      teamKeywords: Array.isArray(teamKeywords) ? teamKeywords : [],
    };
  } catch {
    return { department: "", managerLevel: "", teamKeywords: [] };
  }
}

function normalizeDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function parseDomainFromUrl(url: string): string {
  try {
    const host = normalizeDomain(new URL(url).hostname);
    if (!host) return "";
    const blocked = [
      "linkedin.com",
      "crunchbase.com",
      "wikipedia.org",
      "glassdoor.com",
      "indeed.com",
      "greenhouse.io",
      "lever.co",
    ];
    if (blocked.some((d) => host.endsWith(d))) return "";
    return host;
  } catch {
    return "";
  }
}

async function resolveDomain(company: string): Promise<string> {
  const hunterDomain = await extractDomain(company);
  if (hunterDomain) return hunterDomain;

  const fallbackQueries = [
    `${company} official site`,
    `${company} email domain site:linkedin.com OR site:crunchbase.com`,
  ];

  const results = await searchMultiple(fallbackQueries, 3);
  for (const result of results) {
    const candidate = parseDomainFromUrl(result.url);
    if (candidate) return candidate;
  }

  return "";
}

function buildRecruiterQueries(
  company: string,
  role: string,
  department: string,
  managerLevel: string,
  teamKeywords: string[]
): string[] {
  const keywordText = teamKeywords.filter(Boolean).join(" ");
  return [
    `"${company}" recruiter site:linkedin.com/in "${role}"`,
    `"${company}" "talent acquisition" OR "people partner" site:linkedin.com/in`,
    `"${company}" "${managerLevel || "hiring manager"}" "${department || role}" site:linkedin.com/in`,
    `"${company}" "${keywordText || role}" "hr business partner" site:linkedin.com/in`,
  ];
}

function dedupeProfiles(profiles: RecruiterProfile[]): RecruiterProfile[] {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    const key = (profile.linkedinUrl || `${profile.name}|${profile.title}`).toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function synthesizeProfilesFromSearch(
  company: string,
  role: string,
  searchResults: SearchResult[]
): Promise<RecruiterProfile[]> {
  if (!searchResults.length) return [];

  const snippets = searchResults
    .slice(0, 20)
    .map((result) => `- ${result.title}\n  ${result.snippet}\n  URL: ${result.url}`)
    .join("\n");

  const client = getOpenAIClient();
  const prompt = `Extract likely hiring contacts from these web snippets for ${role} at ${company}.\n\n${snippets}\n\nReturn strict JSON: {"profiles":[{"name":"","title":"","linkedinUrl":"","confidence":0,"contactType":"recruiter|hiring-manager","source":""}]}.\nRules: linkedinUrl must be a LinkedIn profile URL when available. Keep only real people.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You extract recruiter contacts from web snippets. Respond with JSON only." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1200,
    });

    const text = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { profiles?: unknown[] };
    if (!Array.isArray(parsed.profiles)) return [];

    return parsed.profiles
      .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        name: typeof entry.name === "string" ? entry.name : "",
        title: typeof entry.title === "string" ? entry.title : "",
        email: "",
        linkedinUrl: typeof entry.linkedinUrl === "string" ? entry.linkedinUrl : "",
        confidence: typeof entry.confidence === "number" ? entry.confidence : 45,
        source: typeof entry.source === "string" ? entry.source : "searxng web synthesis",
      }))
      .filter((profile) => profile.name && profile.title);
  } catch {
    return [];
  }
}

async function rerankProfiles(
  role: string,
  department: string,
  managerLevel: string,
  teamKeywords: string[],
  profiles: RecruiterProfile[]
): Promise<RecruiterProfile[]> {
  if (profiles.length <= 3) return profiles;

  const client = getOpenAIClient();
  const candidates = profiles
    .map(
      (profile, index) =>
        `[${index}] ${profile.name} | ${profile.title} | confidence=${profile.confidence} | source=${profile.source}`
    )
    .join("\n");

  const prompt = `Rerank candidates for who is most likely involved in hiring for this role.\nRole: ${role}\nDepartment: ${department}\nLikely manager level: ${managerLevel}\nTeam keywords: ${teamKeywords.join(", ")}\n\nCandidates:\n${candidates}\n\nReturn strict JSON: {"ranked":[{"index":0,"score":0,"reason":""}]} sorted best-first, max 3.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a recruiting intelligence ranker. Return JSON only." },
        { role: "user", content: prompt },
      ],
      max_tokens: 600,
    });

    const text = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as { ranked?: Array<{ index?: unknown; score?: unknown }> };
    if (!Array.isArray(parsed.ranked)) return profiles.slice(0, 3);

    const selected = parsed.ranked
      .map((item) => (typeof item.index === "number" ? item.index : -1))
      .filter((index) => index >= 0 && index < profiles.length)
      .slice(0, 3)
      .map((index) => profiles[index]);

    return selected.length ? selected : profiles.slice(0, 3);
  } catch {
    return profiles.slice(0, 3);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, company, role, jobDescription } = body;

    if (!jobId || !company || !role || !jobDescription) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    console.log("Analyzing JD for recruiter research...");
    const extracted = await extractInfo(jobDescription);
    const domain = await resolveDomain(company);
    if (!domain) {
      return NextResponse.json(
        { success: false, error: "Could not resolve company domain" },
        { status: 404 }
      );
    }

    const hunterResults = await findRecruitersAndManagers(domain, extracted.department ?? "");
    const hunterProfiles: RecruiterProfile[] = hunterResults.map((r) => ({
      name: r.name,
      title: r.title,
      email: r.email,
      linkedinUrl: r.linkedinUrl || "",
      confidence: r.confidence,
      source: `hunter.io - ${r.contactType} (${domain})`,
    }));

    const topHunterConfidence = hunterProfiles.reduce(
      (max, profile) => Math.max(max, profile.confidence || 0),
      0
    );
    const shouldUseWebFallback = hunterProfiles.length === 0 || topHunterConfidence < 70;

    let webProfiles: RecruiterProfile[] = [];
    if (shouldUseWebFallback) {
      const queries = buildRecruiterQueries(
        company,
        role,
        extracted.department,
        extracted.managerLevel,
        extracted.teamKeywords
      );
      const searchResults = await searchMultiple(queries, 5);
      webProfiles = await synthesizeProfilesFromSearch(company, role, searchResults);
    }

    const mergedProfiles = dedupeProfiles([...hunterProfiles, ...webProfiles]);
    const rankedProfiles = await rerankProfiles(
      role,
      extracted.department,
      extracted.managerLevel,
      extracted.teamKeywords,
      mergedProfiles
    );

    const profiles = rankedProfiles.slice(0, 3);

    if (profiles.length > 0) {
      const topResult = profiles[0];
      console.log("Saving top result to sheets:", topResult.name);
      await updateJob(jobId, { 
        recruiterName: topResult.name, 
        recruiterTitle: topResult.title,
        recruiterProfileUrl: topResult.linkedinUrl
      });
    }

    return NextResponse.json({ success: true, data: profiles });

  } catch (error: unknown) {
    console.error("Recruiter API error:", error);
    const message = error instanceof Error ? error.message : "Failed to process recruiter research";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
