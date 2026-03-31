import { lookupRecruiterEmail } from "@/lib/hunter";
import { updateJob } from "@/lib/job-store";
import { RecruiterProfile } from "@/types";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { recruiterProfile, company, jobId } = body as {
      recruiterProfile: RecruiterProfile;
      company: string;
      jobId: string;
    };

    if (!recruiterProfile || !company || !jobId) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: recruiterProfile, company, jobId" },
        { status: 400 }
      );
    }

    const result = await lookupRecruiterEmail(recruiterProfile, company);

    // Update job in sheets if email found
    if (result.email) {
      // It might be nice to also update recruiterName if empty in sheets, but we just update email
      await updateJob(jobId, {
        recruiterName: recruiterProfile.name, // Keep it updated
        recruiterEmail: result.email,
        recruiterTitle: recruiterProfile.title, // Note: recruiterTitle is not stored in sheets based on lib/sheets.ts, but let's pass it anyway or omit it
        recruiterProfileUrl: recruiterProfile.linkedinUrl
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
