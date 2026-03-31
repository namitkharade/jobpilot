"use client";

import ResumeEditor from "@/components/ResumeEditor";

export default function ResumePage() {
  return (
    <main className="p-5 md:p-8">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Resume Hub</h2>
        <p className="text-sm text-zinc-500">Upload and manage your base resume plus base cover letter.</p>
      </div>
      <ResumeEditor />
    </main>
  );
}
