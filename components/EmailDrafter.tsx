"use client";

import OutreachComposer from "@/components/OutreachComposer";
import { JobListing, RecruiterProfile } from "@/types";

interface EmailDrafterProps {
  jobId: string;
  recruiter: RecruiterProfile;
  jobListing: JobListing;
  resumeSummary: string;
}

export default function EmailDrafter({ jobListing }: EmailDrafterProps) {
  return <OutreachComposer job={jobListing} />;
}
