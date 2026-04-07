"use client";

import TexDocumentWorkspace from "@/components/TexDocumentWorkspace";

export default function ResumeEditor() {
  return (
    <div className="space-y-6">
      <TexDocumentWorkspace
        title="Resume Hub"
        description="Manage the base resume template that powers ATS analysis and job-specific CV drafts."
        documentLabel="Resume"
        fetchUrl="/api/resume"
        saveUrl="/api/resume"
        compileUrl="/api/resume/compile"
        fileNameFallback="resume.tex"
        saveLabel="Save Resume Template"
      />

      <TexDocumentWorkspace
        title="Cover Letter Hub"
        description="Manage the base cover letter template that job-specific letters are generated from."
        documentLabel="Cover Letter"
        fetchUrl="/api/cover-letter"
        saveUrl="/api/cover-letter"
        compileUrl="/api/cover-letter/compile"
        fileNameFallback="cover-letter.tex"
        saveLabel="Save Cover Letter Template"
      />
    </div>
  );
}
