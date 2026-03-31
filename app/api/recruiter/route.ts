import { extractDomain, findRecruitersAndManagers } from "@/lib/hunter";
import { updateJob } from "@/lib/job-store";
import { getConfig } from "@/lib/local-store";
import { RecruiterProfile } from "@/types";
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

// Remove global client to ensure we always use the latest config-based API key
// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

async function extractInfo(jobDescription: string) {
  const config = getConfig();
  const apiKey = config.apiKeys.openai;
  if (!apiKey) throw new Error("OpenAI API key missing");
  const client = new OpenAI({ apiKey });

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

// Removed braveSearch function in favor of searchWeb from @/lib/searxng

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, company, role, jobDescription } = body;

    if (!jobId || !company || !role || !jobDescription) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    console.log("Analyzing JD for recruiter research...");
    const extracted = await extractInfo(jobDescription);
    const domain = await extractDomain(company);
    if (!domain) {
      return NextResponse.json(
        { success: false, error: "Could not resolve company domain" },
        { status: 404 }
      );
    }

    const hunterResults = await findRecruitersAndManagers(domain, extracted.department ?? "");
    const profiles: RecruiterProfile[] = hunterResults.map((r) => ({
      name: r.name,
      title: r.title,
      email: r.email,
      linkedinUrl: "",
      confidence: r.confidence,
      source: `hunter.io - ${r.contactType} (${domain})`,
    }));

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
