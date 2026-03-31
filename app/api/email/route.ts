import { getConfig } from "@/lib/local-store";
import { searchMultiple } from "@/lib/searxng";
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

async function distillResumeHighlights(resumeText: string): Promise<string> {
  const client = getOpenAIClient();
  const trimmed = resumeText.slice(0, 14000);

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You distill resumes into concise highlights for cold outreach. Respond with JSON only.",
      },
      {
        role: "user",
        content:
          `Summarize this resume into the most relevant outreach highlights. Return JSON as {"highlights":["..."],"skills":["..."]}. Keep highlights specific, preferably quantified, max 6 highlights.\n\nRESUME:\n${trimmed}`,
      },
    ],
    max_tokens: 1000,
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text) as { highlights?: unknown[]; skills?: unknown[] };
  const highlights = Array.isArray(parsed.highlights)
    ? parsed.highlights.filter((h): h is string => typeof h === "string" && h.trim().length > 0).slice(0, 6)
    : [];
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 8)
    : [];

  return [
    ...highlights.map((h) => `- ${h}`),
    skills.length ? `- Core skills: ${skills.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function extractKeyRequirements(jobDescription: string): Promise<string> {
  const client = getOpenAIClient();
  const jdChunk = (jobDescription || "").slice(0, 5000);

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You extract top hiring requirements from job descriptions. Return JSON only.",
      },
      {
        role: "user",
        content: `Extract the top 3 hiring requirements from this job description. Return JSON as {"requirements":["...","...","..."]}.\n\nJD:\n${jdChunk}`,
      },
    ],
    max_tokens: 500,
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text) as { requirements?: unknown[] };
  const requirements = Array.isArray(parsed.requirements)
    ? parsed.requirements.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 3)
    : [];

  return requirements.length ? requirements.map((r) => `- ${r}`).join("\n") : "- Not available";
}

async function getCompanyResearch(company: string, role: string): Promise<string> {
  const results = await searchMultiple(
    [
      `${company} company overview`,
      `${company} latest initiative ${role}`,
      `${company} engineering team hiring roadmap`,
    ],
    2
  );

  return results
    .slice(0, 4)
    .map((r) => `- ${r.title}: ${r.snippet}`)
    .join("\n");
}

export async function POST(req: Request) {
  try {
    const { jobId, recruiter, jobListing, resumeSummary, tone, variant } = await req.json();

    if (!jobId || !recruiter || !jobListing || !resumeSummary || !tone || !variant) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const role = typeof jobListing.title === "string" ? jobListing.title : "";
    const company = typeof jobListing.company === "string" ? jobListing.company : "";

    const [distilledResume, keyRequirements, companyResearch] = await Promise.all([
      distillResumeHighlights(resumeSummary),
      extractKeyRequirements(jobListing.jobDescription || ""),
      getCompanyResearch(company, role),
    ]);

    const systemPrompt = `You are an expert at writing cold outreach emails for job seekers. You write emails that get responses because they are: specific (referencing the exact role and company), brief (under 120 words in the body), human (not AI-sounding), and have a clear single ask. You have studied thousands of successful recruiting cold emails. Respond with ONLY a valid JSON object.`;

    const buildUserPrompt = (t: string) => `Write a cold email for a job application with these details:

SENDER BACKGROUND (use 1-2 of these highlights max, the most relevant ones):
${distilledResume}

TARGET ROLE: ${jobListing.title} at ${jobListing.company}
RECIPIENT: ${recruiter.name}, ${recruiter.title}
RECIPIENT TYPE: ${variant} — adjust the angle accordingly:
  - "recruiter": Focus on fit, keywords, and your eagerness. Reference the specific role.
  - "hiring-manager": Lead with a relevant achievement. Show you understand their team's challenges.
  - "department-head": Lead with business impact. Reference a company initiative or challenge you can address.

KEY REQUIREMENTS FROM JD (the top 3 things they want):
${keyRequirements}

COMPANY RESEARCH NOTES (use for a specific opening hook when relevant):
${companyResearch || "Not available"}

TONE: ${t}

RULES:
1. Subject line: specific and intriguing, never generic like "Job Application" — reference something real
2. Opening: ONE specific hook — a shared connection, a company achievement, or a very specific observation about the role/team. Not a compliment.
3. Body: Max 2-3 sentences. ONE achievement that maps directly to their top requirement. No fluff.
4. Ask: Specific and low-commitment — "Would you have 15 minutes this week or next?" NOT "Please consider me for..."
5. Closing: Warm but brief.
6. Total body word count: under 120 words.
7. NEVER start with 'I', 'My name is', or 'I am writing to'

Respond with ONLY this JSON structure:
{
  "subject": "string",
  "body": "string",
  "wordCount": 0,
  "hookType": "one of: company-achievement | role-observation | mutual-connection | industry-insight",
  "callToAction": "string"
}`;

    const generateVariant = async (t: string) => {
      try {
        const client = getOpenAIClient();
        const response = await client.chat.completions.create({
          model: "gpt-4o",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildUserPrompt(t) }
          ],
          max_tokens: 2000
        });

        const text = response.choices[0].message.content ?? "";
        return JSON.parse(text);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Failed to generate email:", message);
        return null;
      }
    };

    const tones = ["professional", "conversational", "direct"] as const;
    const generated = await Promise.all(tones.map((t) => generateVariant(t)));

    if (generated.some((g) => !g)) {
      return NextResponse.json({ success: false, error: "Failed to generate valid JSON options" }, { status: 500 });
    }

    const byTone = tones.map((t, index) => ({ ...(generated[index] as Record<string, unknown>), _tone: t }));
    const preferredFirst = [
      ...byTone.filter((item) => item._tone === tone),
      ...byTone.filter((item) => item._tone !== tone),
    ];

    return NextResponse.json({
      success: true,
      data: preferredFirst
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate email";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
