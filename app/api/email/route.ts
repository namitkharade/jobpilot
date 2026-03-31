import { getConfig } from "@/lib/local-store";
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

// Remove global client to ensure we always use the latest config-based API key
// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

export async function POST(req: Request) {
  try {
    const { jobId, recruiter, jobListing, resumeSummary, tone, variant } = await req.json();

    if (!jobId || !recruiter || !jobListing || !resumeSummary || !tone || !variant) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const systemPrompt = `You are an expert at writing cold outreach emails for job seekers. You write emails that get responses because they are: specific (referencing the exact role and company), brief (under 120 words in the body), human (not AI-sounding), and have a clear single ask. You have studied thousands of successful recruiting cold emails. Respond with ONLY a valid JSON object.`;

    const buildUserPrompt = (t: string) => `Write a cold email for a job application with these details:

SENDER BACKGROUND (use 1-2 of these highlights max, the most relevant ones):
${resumeSummary}

TARGET ROLE: ${jobListing.title} at ${jobListing.company}
RECIPIENT: ${recruiter.name}, ${recruiter.title}
RECIPIENT TYPE: ${variant} — adjust the angle accordingly:
  - "recruiter": Focus on fit, keywords, and your eagerness. Reference the specific role.
  - "hiring-manager": Lead with a relevant achievement. Show you understand their team's challenges.
  - "department-head": Lead with business impact. Reference a company initiative or challenge you can address.

KEY REQUIREMENTS FROM JD (the top 3 things they want):
Extract these yourself from: ${jobListing.jobDescription ? jobListing.jobDescription.substring(0, 800) : "No description provided."}

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
        const config = getConfig();
        const apiKey = config.apiKeys.openai;
        if (!apiKey) throw new Error("OpenAI API key missing");

        const client = new OpenAI({ apiKey });
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

    // The altTone logic currently only toggles between professional/conversational.
    // Add "direct" as a valid third tone in the altTone selection.
    const altTone = tone === "professional" ? "conversational" : tone === "conversational" ? "direct" : "professional";
    
    const [v1, v2] = await Promise.all([
      generateVariant(tone),
      generateVariant(altTone),
    ]);

    if (!v1 || !v2) {
      return NextResponse.json({ success: false, error: "Failed to generate valid JSON options" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: [
        { ...v1, _tone: tone },
        { ...v2, _tone: altTone }
      ]
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate email";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
